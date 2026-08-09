import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyNoteButton } from "@/components/ar/CopyNoteButton";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { EobNoteForm } from "@/components/eob/EobNoteForm";
import { BackLink } from "@/components/ui/BackLink";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import { canAccessPractice, canManageBatches } from "@/lib/ar-access";
import { describeEscalationTarget } from "@/lib/escalation";
import { formatDate, formatUSD } from "@/lib/format";
import { EobEntryType, Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDateIST, formatDateTimeIST } from "@/lib/timezone";

export const metadata: Metadata = { title: "EOB Entry" };
export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-right text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export default async function EobEntryPage({
  params,
}: {
  params: { entryId: string };
}) {
  const user = await requireUser();

  const entry = await prisma.eobEntry.findUnique({
    where: { id: params.entryId },
    include: {
      assignedTo: { select: { id: true, name: true } },
      resolvedBy: { select: { name: true } },
      batch: {
        select: {
          id: true,
          payerName: true,
          batchDate: true,
          batchReference: true,
          practiceId: true,
          postedById: true,
          postedBy: { select: { name: true } },
          practice: { select: { name: true } },
        },
      },
      workNotes: {
        orderBy: { workedAt: "desc" },
        include: { workedBy: { select: { name: true } } },
      },
    },
  });

  if (!entry || !(await canAccessPractice(user, entry.batch.practiceId))) {
    notFound();
  }

  const isManager = canManageBatches(user);
  const isMine = entry.assignedToId === user.id;
  const canWork = isManager || isMine;

  // Where a hand-over would land, resolved through the same chain the save
  // uses — so the form's promise and the routing cannot disagree.
  const escalation = await describeEscalationTarget({
    practiceId: entry.batch.practiceId,
    batchOwnerId: entry.batch.postedById,
  });

  const assignees = isManager
    ? await prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: [Role.BILLER, Role.PROJECT_MANAGER, Role.OWNER] },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {entry.patientName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {entry.batch.payerName} · DOS {formatDate(entry.dateOfService)}
            {entry.claimNumber ? ` · Claim #${entry.claimNumber}` : ""}
          </p>
        </div>
        {/* Back to the filtered list, not to a bare /eob. */}
        <BackLink href="/eob">← All denials &amp; rejections</BackLink>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Left panel — entry detail */}
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge
                label={entry.statusLabel}
                category={entry.statusCategory}
              />
              <Badge
                variant={
                  entry.entryType === EobEntryType.DENIAL ? "violet" : "amber"
                }
              >
                {entry.entryType === EobEntryType.DENIAL
                  ? "Denial"
                  : "Rejection"}
              </Badge>
            </div>

            <dl className="divide-y divide-slate-100">
              <Row label="Practice">{entry.batch.practice.name}</Row>
              <Row label="Payer">{entry.batch.payerName}</Row>
              <Row label="ERA received">{formatDate(entry.batch.batchDate)}</Row>
              <Row label="Reference">{entry.batch.batchReference ?? "—"}</Row>
              <Row label="CPT">{entry.cptCode ?? "—"}</Row>
              <Row label="Billed">
                {entry.billedAmount
                  ? formatUSD(entry.billedAmount.toString())
                  : "—"}
              </Row>
              <Row label="Denied">
                <span className="font-semibold">
                  {entry.deniedAmount
                    ? formatUSD(entry.deniedAmount.toString())
                    : "—"}
                </span>
              </Row>
              <Row label="Denial code">{entry.denialCode ?? "—"}</Row>
              <Row label="Reason">{entry.denialReason}</Row>
              <Row label="Rejection reason">{entry.rejectionReason ?? "—"}</Row>
              <Row label="Action required">{entry.actionRequired ?? "—"}</Row>
              <Row label="Assigned to">
                {entry.assignedTo?.name ?? (
                  <Badge variant="amber">Unassigned</Badge>
                )}
              </Row>
              <Row label="Resolved">
                {entry.resolvedAt ? (
                  <>
                    {formatDateIST(entry.resolvedAt)}
                    <span className="block text-xs text-slate-400">
                      {entry.resolvedBy?.name}
                    </span>
                  </>
                ) : (
                  "Not yet"
                )}
              </Row>
            </dl>

            {entry.resolutionNote ? (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-inset ring-emerald-200">
                {entry.resolutionNote}
              </p>
            ) : null}

            {entry.arClaimId ? (
              <Link
                href={`/ar/claims/${entry.arClaimId}`}
                className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
              >
                View AR Claim
              </Link>
            ) : null}
          </div>
        </div>

        {/* Right panel — work log and note form */}
        <div className="space-y-4 lg:col-span-3">
          <div className="rounded-xl border border-slate-200 bg-white shadow-card">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Work log
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {entry.workNotes.length} note
                  {entry.workNotes.length === 1 ? "" : "s"} · permanent audit
                  trail
                </span>
              </h3>
            </div>

            <div className="px-4 py-3">
              {entry.workNotes.length === 0 ? (
                <EmptyState title="No work logged yet" />
              ) : (
                <ul className="space-y-3">
                  {entry.workNotes.map((note) => (
                    <li
                      key={note.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <StatusBadge
                          label={note.statusChangedTo}
                          category={note.statusCategoryChangedTo}
                        />
                        <CopyNoteButton text={note.note} />
                      </div>
                      <p className="whitespace-pre-wrap rounded bg-white px-2.5 py-2 font-mono text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200">
                        {note.note}
                      </p>
                      <p className="mt-2 text-[11px] text-slate-400">
                        {note.workedBy.name} ·{" "}
                        {formatDateTimeIST(note.workedAt)}
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
            <EobNoteForm
              entryId={entry.id}
              currentStatus={entry.statusLabel}
              assignees={assignees}
              canReassign={isManager}
              projectManagerName={escalation.name ?? entry.batch.postedBy.name}
              hasPrimaryPm={escalation.hasPrimaryPm}
              disabled={!canWork}
              disabledReason="This entry is assigned to someone else."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
