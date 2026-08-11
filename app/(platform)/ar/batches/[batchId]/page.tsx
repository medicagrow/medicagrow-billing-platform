import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddClaimModal } from "@/components/ar/AddClaimModal";
import {
  BatchClaimsPanel,
  type TabKey,
} from "@/components/ar/BatchClaimsPanel";
import { CloseBatchButton } from "@/components/ar/CloseBatchButton";
import { CategoryPills } from "@/components/ar/StatusBadge";
import { TargetDateEditor } from "@/components/ar/TargetDateEditor";
import { Badge } from "@/components/ui/Badge";
import {
  canAccessBatch,
  canManageBatches,
  practiceAssignees,
} from "@/lib/ar-access";
import { excludedNote } from "@/lib/ar-actionable";
import { countReassignedToMe } from "@/lib/ar-reassignment";
import { EHR_SOURCE_LABELS } from "@/lib/ehr-labels";
import { batchStats, daysBetween } from "@/lib/ar-stats";
import { formatDate, formatUSD } from "@/lib/format";
import { BatchStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDateIST } from "@/lib/timezone";

export const metadata: Metadata = { title: "Batch Detail" };
export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "red";
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          tone === "amber"
            ? "text-amber-700"
            : tone === "red"
              ? "text-red-700"
              : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  params: { batchId: string };
  /** A count on a dashboard links in here already filtered. */
  searchParams: { statusCategory?: string; overdue?: string; tab?: string };
}) {
  const user = await requireUser();

  const initialTab: TabKey =
    searchParams.tab === "reassigned"
      ? "reassigned"
      : searchParams.overdue === "true"
        ? "overdue"
        : searchParams.statusCategory === "RED"
          ? "red"
          : searchParams.statusCategory === "BLUE"
            ? "blue"
            : "all";

  if (!(await canAccessBatch(user, params.batchId))) {
    notFound();
  }

  const batch = await prisma.arBatch.findUnique({
    where: { id: params.batchId },
    include: {
      practice: { select: { id: true, name: true } },
      uploadedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
  });

  if (!batch) notFound();

  const isManager = canManageBatches(user);
  const closed = batch.status === BatchStatus.CLOSED;

  const [stats, reassignedToMeCount] = await Promise.all([
    batchStats(batch.id),
    // Only a manager has people who can hand work back to them.
    isManager
      ? countReassignedToMe(user.id, batch.id)
      : Promise.resolve(0),
  ]);

  // Only people who can actually open this batch are offered as assignees.
  const [assignees, insurances, providerRows, visitStatuses] =
    await Promise.all([
    isManager ? practiceAssignees(batch.practiceId) : Promise.resolve([]),
    prisma.arClaim.findMany({
      where: { batchId: batch.id },
      distinct: ["insuranceName"],
      select: { insuranceName: true },
      orderBy: { insuranceName: "asc" },
    }),
    /**
     * Provider filter options. An import fills `providerName`; a matched
     * roster entry fills `renderingProvider`. The column shows whichever it
     * has, so the filter has to offer both, merged.
     */
    prisma.arClaim.findMany({
        where: { batchId: batch.id },
        select: { renderingProvider: true, providerName: true },
      }),
      /**
       * Visit status is an optional export field. Most batches have none, and
       * the filter is only rendered when this comes back with something —
       * offering an empty dropdown suggests data that is not there.
       */
      prisma.arClaim.findMany({
        where: { batchId: batch.id, visitStatus: { not: null } },
        distinct: ["visitStatus"],
        select: { visitStatus: true },
        orderBy: { visitStatus: "asc" },
      }),
    ]);

  const visitStatusOptions = visitStatuses
    .map((row) => row.visitStatus?.trim())
    .filter((status): status is string => Boolean(status));

  const providerOptions = Array.from(
    new Set(
      providerRows
        .flatMap((row) => [row.renderingProvider, row.providerName])
        .map((name) => name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const daysOpen = daysBetween(batch.uploadedAt, batch.closedAt ?? new Date());


  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              {batch.practice.name}
            </h2>
            <Badge variant={closed ? "neutral" : "brand"}>
              {closed ? "Closed" : "Open"}
            </Badge>
            <Badge variant="neutral">
              {EHR_SOURCE_LABELS[batch.ehrSource]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {MONTH_NAMES[batch.reportMonth - 1]} {batch.reportYear} · uploaded by{" "}
            {batch.uploadedBy.name} on {formatDateIST(batch.uploadedAt)}
            {batch.insuranceName ? ` · ${batch.insuranceName}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/ar/practices/${batch.practice.id}`}
            className="text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            Batch history
          </Link>
          {isManager && !closed ? (
            <>
              <AddClaimModal batchId={batch.id} assignees={assignees} />
              <CloseBatchButton batchId={batch.id} stats={stats} />
            </>
          ) : null}
        </div>
      </div>

      {closed ? (
        <div className="mb-4 rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
          This batch was closed
          {batch.closedAt ? ` on ${formatDate(batch.closedAt)}` : ""}
          {batch.closedBy ? ` by ${batch.closedBy.name}` : ""}. It is read-only —
          no notes or status changes can be made.
        </div>
      ) : null}

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Total claims" value={String(stats.totalClaims)} />
          <Stat label="Total balance" value={formatUSD(stats.totalBalance)} />
          <Stat label="Days open" value={String(daysOpen)} tone={daysOpen > 60 ? "amber" : undefined} />
          <Stat
            label="Unassigned"
            value={String(stats.unassignedCount)}
            tone={stats.unassignedCount > 0 ? "amber" : undefined}
          />
          <Stat
            label="Overdue"
            value={String(stats.overdueCount)}
            tone={stats.overdueCount > 0 ? "red" : undefined}
          />
          {isManager ? (
            <a
              href="?tab=reassigned#reassigned-to-me"
              className="block rounded transition-colors hover:bg-amber-50"
            >
              <Stat
                label="Reassigned to me"
                value={String(reassignedToMeCount)}
                tone={reassignedToMeCount > 0 ? "amber" : undefined}
              />
            </a>
          ) : null}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Target date
            </p>
            <TargetDateEditor
              batchId={batch.id}
              value={batch.targetCompletionDate?.toISOString() ?? null}
              canEdit={isManager && !closed}
            />
          </div>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <CategoryPills
            green={stats.percentGreen}
            red={stats.percentRed}
            blue={stats.percentBlue}
          />
          {/*
            The completion rate is over claims the team was actually allowed to
            work. Saying so matters: without the note the percentage looks
            wrong to anyone who divides the green count by the total.
          */}
          {stats.notActionableCount > 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              {excludedNote(stats.notActionableCount)} — {stats.actionableClaims}{" "}
              of {stats.totalClaims} claims counted.
            </p>
          ) : null}
        </div>
      </div>

      <BatchClaimsPanel
        batchId={batch.id}
        canAssign={isManager}
        batchClosed={closed}
        assignees={assignees}
        insuranceOptions={insurances.map((row) => row.insuranceName)}
        providerOptions={providerOptions}
        visitStatusOptions={visitStatusOptions}
        initialTab={initialTab}
        showReassignedTab={isManager}
        reassignedCount={reassignedToMeCount}
      />
    </div>
  );
}
