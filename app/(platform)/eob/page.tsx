import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EobEntriesClient } from "@/components/eob/EobEntriesClient";
import { LogEobModal } from "@/components/eob/LogEobModal";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { isDateWithinSupportedRange } from "@/lib/calendar";
import {
  EobEntryType,
  Role,
  StatusCategory,
} from "@/lib/generated/prisma/enums";
import { formatUSD } from "@/lib/format";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "EOB/ERA" };
export const dynamic = "force-dynamic";

/**
 * A figure over the entry list.
 *
 * Where the number names a subset of the list below, it links to that subset —
 * the list reads the same query params, so the card and the table agree.
 */
function SummaryCard({
  label,
  value,
  tone,
  href,
  hint,
}: {
  label: string;
  value: string;
  tone?: "red" | "amber";
  href?: string;
  /** A second figure the headline needs in order to be read correctly. */
  hint?: string;
}) {
  const toneClass =
    tone === "red"
      ? "text-red-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-slate-900";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      {href ? (
        <Link
          href={href}
          className={`mt-1 block text-2xl font-semibold tabular-nums underline-offset-4 hover:underline ${toneClass}`}
        >
          {value}
        </Link>
      ) : (
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
          {value}
        </p>
      )}
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default async function EobHomePage({
  searchParams,
}: {
  searchParams: {
    practiceId?: string;
    entryType?: string;
    statusCategory?: string;
  };
}) {
  const user = await requireUser();
  const practiceIds = await accessiblePracticeIds(user);

  const selectedPracticeId =
    searchParams.practiceId &&
    (practiceIds === null || practiceIds.includes(searchParams.practiceId))
      ? searchParams.practiceId
      : undefined;

  const practiceFilter = selectedPracticeId
    ? { practiceId: selectedPracticeId }
    : practiceIds === null
      ? {}
      : { practiceId: { in: practiceIds } };

  // The summary cards are server-rendered against the whole scope; the table
  // below fetches its own rows so filtering and sorting stay interactive.
  const [
    unresolved,
    resolved,
    practices,
    memberships,
    payers,
    assignableUsers,
  ] = await Promise.all([
      prisma.eobEntry.findMany({
        where: {
          batch: practiceFilter,
          statusCategory: { not: StatusCategory.GREEN },
        },
        select: { entryType: true, deniedAmount: true },
      }),
      // Resolution time is measured from when the remittance arrived.
      prisma.eobEntry.findMany({
        where: { batch: practiceFilter, resolvedAt: { not: null } },
        select: { resolvedAt: true, batch: { select: { batchDate: true } } },
        take: 500,
        orderBy: { resolvedAt: "desc" },
      }),
      prisma.practice.findMany({
        where: {
          isActive: true,
          ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      // Who may be assigned an entry, per practice. Small enough to send
      // whole, and it saves a round trip every time the practice changes.
      prisma.userPractice.findMany({
        where: {
          user: { isActive: true },
          ...(practiceIds === null ? {} : { practiceId: { in: practiceIds } }),
        },
        select: {
          practiceId: true,
          user: { select: { id: true, name: true } },
        },
        orderBy: { user: { name: "asc" } },
      }),
      prisma.eobBatch.findMany({
        where: practiceFilter,
        distinct: ["payerName"],
        select: { payerName: true },
        orderBy: { payerName: "asc" },
        take: 100,
      }),
      prisma.user.findMany({
        where: {
          isActive: true,
          ...(user.role === Role.OWNER
            ? {}
            : {
                practices: {
                  some: { practice: { users: { some: { userId: user.id } } } },
                },
              }),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  // Owners hold no UserPractice rows, so they are added to every practice's
  // list explicitly — otherwise an owner could not assign an entry to anyone.
  const membersByPractice: Record<string, { id: string; name: string }[]> = {};

  for (const practice of practices) {
    membersByPractice[practice.id] = memberships
      .filter((row) => row.practiceId === practice.id)
      .map((row) => row.user);
  }

  if (user.role === Role.OWNER) {
    for (const list of Object.values(membersByPractice)) {
      if (!list.some((member) => member.id === user.id)) {
        list.unshift({ id: user.id, name: user.name ?? "Me" });
      }
    }
  }

  const unresolvedDenials = unresolved.filter(
    (entry) => entry.entryType === EobEntryType.DENIAL,
  ).length;
  const unresolvedRejections = unresolved.filter(
    (entry) => entry.entryType === EobEntryType.REJECTION,
  ).length;

  let atRiskCents = 0n;
  for (const entry of unresolved) {
    atRiskCents += toCents(entry.deniedAmount?.toString() ?? "0");
  }

  /**
   * Days from the remittance arriving to the entry being resolved.
   *
   * Two guards, both learned the hard way (CALC-03). A batch date outside the
   * supported range is a mistyped year, and one of them — a batch dated 0206 —
   * single-handedly moved this average to 2,428 days against a median of 6, so
   * out-of-range rows are left out and counted instead. And the median is
   * shown beside the mean, because one genuine six-month argument with a payer
   * drags a mean of a few hundred entries and the card gives no hint of it.
   *
   * A negative gap (resolved before the remittance arrived) is also a data
   * error rather than a fast resolution, so it is excluded on the same basis.
   */
  const resolutionDays: number[] = [];
  let excludedFromResolution = 0;

  for (const entry of resolved) {
    const batchDate = entry.batch.batchDate;
    const inRange = isDateWithinSupportedRange(
      batchDate.toISOString().slice(0, 10),
    );
    const days =
      (entry.resolvedAt!.getTime() - batchDate.getTime()) / 86_400_000;

    if (!inRange || days < 0) {
      excludedFromResolution += 1;
      continue;
    }

    resolutionDays.push(days);
  }

  const avgDaysToResolve =
    resolutionDays.length === 0
      ? null
      : Math.round(
          resolutionDays.reduce((total, days) => total + days, 0) /
            resolutionDays.length,
        );

  const medianDaysToResolve =
    resolutionDays.length === 0
      ? null
      : Math.round(
          [...resolutionDays].sort((a, b) => a - b)[
            Math.floor(resolutionDays.length / 2)
          ]!,
        );

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="EOB/ERA Denials & Rejections"
        description="Every denial and rejection across all remittances."
        action={
          <LogEobModal
            practices={practices}
            payerSuggestions={payers.map((row) => row.payerName)}
            membersByPractice={membersByPractice}
            currentUser={{ id: user.id, name: user.name ?? "Me" }}
            canAssignOthers={user.role !== Role.BILLER}
          />
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Unresolved denials"
          value={String(unresolvedDenials)}
          tone={unresolvedDenials > 0 ? "red" : undefined}
          href="/eob?entryType=DENIAL&statusCategory=RED"
        />
        <SummaryCard
          label="Unresolved rejections"
          value={String(unresolvedRejections)}
          tone={unresolvedRejections > 0 ? "amber" : undefined}
          href="/eob?entryType=REJECTION&statusCategory=RED"
        />
        <SummaryCard
          label="Amount at risk"
          value={formatUSD(centsToDecimalString(atRiskCents))}
        />
        <SummaryCard
          label="Avg days to resolve"
          value={avgDaysToResolve === null ? "—" : String(avgDaysToResolve)}
          hint={
            medianDaysToResolve === null
              ? undefined
              : `Median ${medianDaysToResolve} · ${resolutionDays.length} resolved` +
                (excludedFromResolution > 0
                  ? ` · ${excludedFromResolution} excluded (bad batch date)`
                  : "")
          }
        />
      </div>

      <EobEntriesClient
        practices={practices}
        assignableUsers={assignableUsers}
        initialEntryType={searchParams.entryType ?? ""}
        initialStatusCategory={searchParams.statusCategory ?? ""}
      />
    </div>
  );
}
