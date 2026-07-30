import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import { EOB_ENTRY_INCLUDE, toEobEntryDto } from "@/lib/eob-serialize";
import { formatDate, formatUSD } from "@/lib/format";
import {
  EobEntryType,
  Role,
  StatusCategory,
} from "@/lib/generated/prisma/enums";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "EOB Queue" };
export const dynamic = "force-dynamic";

export default async function EobMyQueuePage({
  searchParams,
}: {
  searchParams: { practiceId?: string };
}) {
  const user = await requireUser();

  /**
   * Same four-condition contract as the AR queue, in one query: assigned to
   * me, RED, and in a practice I am assigned to. Owners skip the practice
   * join since they have no UserPractice rows.
   */
  const practiceScope =
    user.role === Role.OWNER
      ? {}
      : { practice: { users: { some: { userId: user.id } } } };

  const where = {
    assignedToId: user.id,
    statusCategory: StatusCategory.RED,
    batch: {
      ...practiceScope,
      ...(searchParams.practiceId
        ? { practiceId: searchParams.practiceId }
        : {}),
    },
  };

  const entries = await prisma.eobEntry.findMany({
    where,
    orderBy: [{ dateOfService: "asc" }, { patientName: "asc" }],
    take: 200,
    include: {
      ...EOB_ENTRY_INCLUDE,
      batch: {
        select: { payerName: true, practice: { select: { name: true } } },
      },
    },
  });

  const rows = entries.map(toEobEntryDto);

  let cents = 0n;
  for (const row of rows) cents += toCents(row.deniedAmount ?? "0");

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="My EOB Queue"
        description="Denials and rejections assigned to you, oldest service date first."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Entries in queue
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {rows.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Amount at risk
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {formatUSD(centsToDecimalString(cents))}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Denials / rejections
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {rows.filter((row) => row.entryType === EobEntryType.DENIAL).length}{" "}
            /{" "}
            {
              rows.filter((row) => row.entryType === EobEntryType.REJECTION)
                .length
            }
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Your EOB queue is empty — nothing assigned to you"
          description="Denials appear here when a project manager assigns them to you."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">Claim#</th>
                <th className="px-4 py-3">DOS</th>
                <th className="px-4 py-3">Payer</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Denied</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Practice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/eob/entries/${row.id}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {row.patientName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.claimNumber ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {formatDate(row.dateOfService)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.payerName}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        row.entryType === EobEntryType.DENIAL
                          ? "violet"
                          : "amber"
                      }
                    >
                      {row.entryType === EobEntryType.DENIAL
                        ? "Denial"
                        : "Rejection"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    {row.deniedAmount ? formatUSD(row.deniedAmount) : "—"}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-slate-600">
                    {row.denialReason}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={row.statusLabel}
                      category={row.statusCategory}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.practiceName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
