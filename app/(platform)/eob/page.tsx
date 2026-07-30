import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { EobEntriesClient } from "@/components/eob/EobEntriesClient";
import { LogEobModal } from "@/components/eob/LogEobModal";
import { accessiblePracticeIds } from "@/lib/ar-access";
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

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red" | "amber";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "red"
            ? "text-red-700"
            : tone === "amber"
              ? "text-amber-700"
              : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default async function EobHomePage({
  searchParams,
}: {
  searchParams: { practiceId?: string };
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
  const [unresolved, resolved, practices, payers, assignableUsers] =
    await Promise.all([
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

  const avgDaysToResolve =
    resolved.length === 0
      ? null
      : Math.round(
          resolved.reduce(
            (total, entry) =>
              total +
              (entry.resolvedAt!.getTime() - entry.batch.batchDate.getTime()) /
                86_400_000,
            0,
          ) / resolved.length,
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
          />
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Unresolved denials"
          value={String(unresolvedDenials)}
          tone={unresolvedDenials > 0 ? "red" : undefined}
        />
        <SummaryCard
          label="Unresolved rejections"
          value={String(unresolvedRejections)}
          tone={unresolvedRejections > 0 ? "amber" : undefined}
        />
        <SummaryCard
          label="Amount at risk"
          value={formatUSD(centsToDecimalString(atRiskCents))}
        />
        <SummaryCard
          label="Avg days to resolve"
          value={avgDaysToResolve === null ? "—" : String(avgDaysToResolve)}
        />
      </div>

      <EobEntriesClient
        practices={practices}
        assignableUsers={assignableUsers}
      />
    </div>
  );
}
