import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddClaimModal } from "@/components/ar/AddClaimModal";
import { BatchClaimsPanel } from "@/components/ar/BatchClaimsPanel";
import { CloseBatchButton } from "@/components/ar/CloseBatchButton";
import { CategoryPills } from "@/components/ar/StatusBadge";
import { TargetDateEditor } from "@/components/ar/TargetDateEditor";
import { Badge } from "@/components/ui/Badge";
import { canAccessBatch, canManageBatches } from "@/lib/ar-access";
import { EHR_SOURCE_LABELS } from "@/lib/ehr-labels";
import { batchStats, daysBetween } from "@/lib/ar-stats";
import { formatDate, formatUSD } from "@/lib/format";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

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
}: {
  params: { batchId: string };
}) {
  const user = await requireUser();

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

  const stats = await batchStats(batch.id);
  const isManager = canManageBatches(user);
  const closed = batch.status === BatchStatus.CLOSED;

  const [assignees, insurances] = await Promise.all([
    isManager
      ? prisma.user.findMany({
          where: {
            isActive: true,
            role: { in: [Role.BILLER, Role.PROJECT_MANAGER, Role.OWNER] },
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true, role: true },
        })
      : Promise.resolve([]),
    prisma.arClaim.findMany({
      where: { batchId: batch.id },
      distinct: ["insuranceName"],
      select: { insuranceName: true },
      orderBy: { insuranceName: "asc" },
    }),
  ]);

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
            {batch.uploadedBy.name} on {formatDate(batch.uploadedAt)}
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
        </div>
      </div>

      <BatchClaimsPanel
        batchId={batch.id}
        canAssign={isManager}
        batchClosed={closed}
        assignees={assignees}
        insuranceOptions={insurances.map((row) => row.insuranceName)}
      />
    </div>
  );
}
