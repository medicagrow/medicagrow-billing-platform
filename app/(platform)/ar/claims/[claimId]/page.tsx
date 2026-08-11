import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgingBadge } from "@/components/ar/AgingBadge";
import { CopyNoteButton } from "@/components/ar/CopyNoteButton";
import { ClaimContextPanels } from "@/components/ar/ClaimContextPanels";
import { matchProvider } from "@/lib/ar-provider-match";
import {
  PriorHistoryPanel,
  type PriorRecord,
} from "@/components/ar/PriorHistoryPanel";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { WorkNoteForm } from "@/components/ar/WorkNoteForm";
import { Badge } from "@/components/ui/Badge";
import { BackLink } from "@/components/ui/BackLink";
import { EmptyState } from "@/components/ui/Card";
import { canAccessBatch, canManageBatches } from "@/lib/ar-access";
import { OUTCOME_LABELS } from "@/lib/ar-outcomes";
import { EHR_SOURCE_LABELS } from "@/lib/ehr-labels";
import { describeEscalationTarget } from "@/lib/escalation";
import { startOfTodayUtc } from "@/lib/ar-stats";
import { formatDate, formatUSD } from "@/lib/format";
import { BatchStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDateTimeIST } from "@/lib/timezone";

export const metadata: Metadata = { title: "Claim Detail" };
export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PRIOR_HISTORY_DAY_WINDOW = 7;

function fuzzyToken(patientName: string): string {
  const tokens = patientName
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  return tokens.sort((a, b) => b.length - a.length)[0] ?? patientName;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-right text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export default async function ClaimDetailPage({
  params,
}: {
  params: { claimId: string };
}) {
  const user = await requireUser();

  const claim = await prisma.arClaim.findUnique({
    where: { id: params.claimId },
    include: {
      assignedTo: { select: { id: true, name: true } },
      lastWorkedBy: { select: { name: true } },
      batch: {
        select: {
          id: true,
          status: true,
          reportMonth: true,
          reportYear: true,
          ehrSource: true,
          uploadedById: true,
          uploadedBy: { select: { name: true } },
          practice: {
            select: {
              id: true,
              name: true,
              billingAddressLine1: true,
              billingAddressLine2: true,
              billingCity: true,
              billingState: true,
              billingZip: true,
              npi: true,
              taxId: true,
              medicarePtan: true,
            },
          },
        },
      },
      workNotes: {
        orderBy: { workedAt: "desc" },
        include: { workedBy: { select: { name: true } } },
      },
    },
  });

  if (!claim || !(await canAccessBatch(user, claim.batchId))) {
    notFound();
  }

  // Where a hand-over would land, resolved through the same chain the save
  // uses — so the form's promise and the routing cannot disagree.
  const escalation = await describeEscalationTarget({
    practiceId: claim.batch.practice.id,
    batchOwnerId: claim.batch.uploadedById,
  });

  const windowStart = new Date(claim.dateOfService);
  windowStart.setUTCDate(windowStart.getUTCDate() - PRIOR_HISTORY_DAY_WINDOW);
  const windowEnd = new Date(claim.dateOfService);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + PRIOR_HISTORY_DAY_WINDOW);

  const priorClaims = await prisma.arClaim.findMany({
    where: {
      id: { not: claim.id },
      insuranceName: { equals: claim.insuranceName, mode: "insensitive" },
      dateOfService: { gte: windowStart, lte: windowEnd },
      patientName: {
        contains: fuzzyToken(claim.patientName),
        mode: "insensitive",
      },
      batch: {
        practiceId: claim.batch.practice.id,
        status: BatchStatus.CLOSED,
      },
    },
    take: 5,
    orderBy: { dateOfService: "desc" },
    include: {
      batch: { select: { reportMonth: true, reportYear: true } },
      workNotes: {
        orderBy: { workedAt: "desc" },
        include: { workedBy: { select: { name: true } } },
      },
    },
  });

  // Same matcher the API uses, so the panel and the endpoint agree.
  const providerMatch = await matchProvider(
    claim.batch.practice.id,
    claim.renderingProvider,
  );

  const priorHistory: PriorRecord[] = priorClaims.map((prior) => ({
    id: prior.id,
    reportMonth: prior.batch.reportMonth,
    reportYear: prior.batch.reportYear,
    dateOfService: prior.dateOfService.toISOString(),
    patientName: prior.patientName,
    insuranceName: prior.insuranceName,
    balance: prior.balance.toString(),
    statusLabel: prior.statusLabel,
    statusCategory: prior.statusCategory,
    notes: prior.workNotes.map((note) => ({
      id: note.id,
      generatedNote: note.generatedNote,
      additionalNotes: note.additionalNotes,
      outcomeType: note.outcomeType,
      workedByName: note.workedBy.name,
      workedAt: note.workedAt.toISOString(),
    })),
  }));

  const closed = claim.batch.status === BatchStatus.CLOSED;
  const isManager = canManageBatches(user);
  const isAssignedToMe = claim.assignedToId === user.id;
  const canWorkClaim = !closed && (isManager || isAssignedToMe);

  const overdue =
    claim.followUpDate !== null &&
    claim.followUpDate < startOfTodayUtc() &&
    claim.statusCategory === "RED";

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {claim.patientName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {claim.insuranceName} · DOS {formatDate(claim.dateOfService)}
            {claim.claimNumber ? ` · Claim #${claim.claimNumber}` : ""}
          </p>
        </div>
        {/*
          Goes back rather than to a bare batch URL — the filters the person
          had applied live in that URL's query string.
        */}
        <BackLink href={`/ar/batches/${claim.batch.id}`}>
          ← Back to batch
        </BackLink>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Left panel — claim information */}
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge
                label={claim.statusLabel}
                category={claim.statusCategory}
              />
              <AgingBadge days={claim.agingDays} />
              <Badge variant="neutral">
                {EHR_SOURCE_LABELS[claim.batch.ehrSource]}
              </Badge>
            </div>

            <dl className="divide-y divide-slate-100">
              <Row label="Balance">
                <span className="font-semibold tabular-nums">
                  {formatUSD(claim.balance.toString())}
                </span>
              </Row>
              <Row label="Billed amount">
                <span className="tabular-nums">
                  {claim.billedAmount
                    ? formatUSD(claim.billedAmount.toString())
                    : "—"}
                </span>
              </Row>
              <Row label="Insurance paid">
                <span className="tabular-nums">
                  {claim.insurancePaid
                    ? formatUSD(claim.insurancePaid.toString())
                    : "—"}
                </span>
              </Row>
              <Row label="Patient paid">
                <span className="tabular-nums">
                  {claim.patientPaid
                    ? formatUSD(claim.patientPaid.toString())
                    : "—"}
                </span>
              </Row>
              <Row label="CPT code">{claim.cptCode ?? "—"}</Row>
              {/*
                Optional reference fields only some EHRs export. Rendered only
                when the claim carries one: a row of dashes on every claim in
                the system to serve the few that have them is a worse trade
                than the field being absent where it is meaningless.
              */}
              {claim.visitId ? (
                <Row label="Visit ID">
                  <span className="font-mono text-xs">{claim.visitId}</span>
                </Row>
              ) : null}
              {claim.visitStatus ? (
                <Row label="Visit Status">{claim.visitStatus}</Row>
              ) : null}
              <Row label="Patient ID">{claim.patientId ?? "—"}</Row>
              <Row label="Subscriber ID">{claim.subscriberId ?? "—"}</Row>
              <Row label="Provider">
                {claim.providerName ?? claim.renderingProvider ?? "—"}
              </Row>
              <Row label="Assigned to">
                {claim.assignedTo?.name ?? (
                  <Badge variant="amber">Unassigned</Badge>
                )}
              </Row>
              <Row label="Follow-up date">
                {claim.followUpDate ? (
                  <span
                    className={overdue ? "font-medium text-red-600" : undefined}
                  >
                    {formatDate(claim.followUpDate)}
                    {overdue ? " (overdue)" : ""}
                  </span>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Last worked">
                {claim.lastWorkedAt ? (
                  <>
                    {formatDate(claim.lastWorkedAt)}
                    <span className="block text-xs text-slate-400">
                      {claim.lastWorkedBy?.name}
                    </span>
                  </>
                ) : (
                  "Never"
                )}
              </Row>
              <Row label="Batch">
                <Link
                  href={`/ar/batches/${claim.batch.id}`}
                  className="text-brand-700 hover:text-brand-800"
                >
                  {claim.batch.practice.name} ·{" "}
                  {MONTH_NAMES[claim.batch.reportMonth - 1]}{" "}
                  {claim.batch.reportYear}
                </Link>
              </Row>
            </dl>
          </div>

          <ClaimContextPanels
            claimId={claim.id}
            practice={claim.batch.practice}
            renderingProvider={claim.renderingProvider}
            providerMatch={providerMatch}
          />

          <PriorHistoryPanel records={priorHistory} />
        </div>

        {/* Right panel — work log + note form */}
        <div className="space-y-4 lg:col-span-3">
          <div className="rounded-xl border border-slate-200 bg-white shadow-card">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Work log
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {claim.workNotes.length} note
                  {claim.workNotes.length === 1 ? "" : "s"} · permanent audit
                  trail
                </span>
              </h3>
            </div>

            <div className="px-4 py-3">
              {claim.workNotes.length === 0 ? (
                <EmptyState
                  title="No work logged yet"
                  description="The first note on this claim will appear here."
                />
              ) : (
                <ul className="space-y-3">
                  {claim.workNotes.map((note) => (
                    <li
                      key={note.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="neutral">
                            {OUTCOME_LABELS[note.outcomeType]}
                          </Badge>
                          <StatusBadge
                            label={note.statusChangedTo}
                            category={note.statusCategoryChangedTo}
                          />
                        </div>
                        <CopyNoteButton
                          text={note.generatedNote}
                          additionalNotes={note.additionalNotes}
                        />
                      </div>
                      <p className="whitespace-pre-wrap rounded bg-white px-2.5 py-2 font-mono text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200">
                        {note.generatedNote}
                      </p>
                      {note.additionalNotes ? (
                        <p className="mt-1.5 text-xs italic text-slate-600">
                          {note.additionalNotes}
                        </p>
                      ) : null}
                      <p className="mt-2 text-[11px] text-slate-400">
                        {note.workedBy.name} ·{" "}
                        {formatDateTimeIST(note.workedAt)}
                        {note.followUpDateSet
                          ? ` · follow-up ${formatDate(note.followUpDateSet)}`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              Log new note
            </h3>
            <WorkNoteForm
              claimId={claim.id}
              claimNumber={claim.claimNumber}
              projectManagerName={escalation.name ?? claim.batch.uploadedBy.name}
              hasPrimaryPm={escalation.hasPrimaryPm}
              disabled={!canWorkClaim}
              disabledReason={
                closed
                  ? "This batch is closed and permanently read-only."
                  : "This claim is assigned to someone else."
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
