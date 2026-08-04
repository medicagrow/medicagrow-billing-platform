import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import { canAccessPractice } from "@/lib/ar-access";
import { BatchStatus, StatusCategory } from "@/lib/generated/prisma/enums";
import { EHR_SOURCE_LABELS } from "@/lib/ehr-labels";
import { formatDate, formatUSD } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDateIST } from "@/lib/timezone";

export const metadata: Metadata = { title: "Batch History" };
export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function PracticeBatchHistoryPage({
  params,
}: {
  params: { practiceId: string };
}) {
  const user = await requireUser();

  if (!(await canAccessPractice(user, params.practiceId))) {
    notFound();
  }

  const practice = await prisma.practice.findUnique({
    where: { id: params.practiceId },
    select: { id: true, name: true, ehrSource: true },
  });

  if (!practice) notFound();

  const batches = await prisma.arBatch.findMany({
    where: { practiceId: practice.id },
    orderBy: [{ reportYear: "desc" }, { reportMonth: "desc" }],
    include: {
      uploadedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
  });

  const greenCounts = await prisma.arClaim.groupBy({
    by: ["batchId"],
    where: {
      batchId: { in: batches.map((batch) => batch.id) },
      statusCategory: StatusCategory.GREEN,
    },
    _count: { _all: true },
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={practice.name}
        description={`Batch history — ${EHR_SOURCE_LABELS[practice.ehrSource]}`}
        action={
          <Link
            href="/ar"
            className="text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            ← All practices
          </Link>
        }
      />

      {batches.length === 0 ? (
        <EmptyState
          title="No batches yet"
          description="Upload the first AR report for this practice from the Practices page."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Report period</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Claims</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">Complete</th>
                <th className="px-4 py-3">Uploaded by</th>
                <th className="px-4 py-3">Uploaded</th>
                <th className="px-4 py-3">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((batch) => {
                const green =
                  greenCounts.find((row) => row.batchId === batch.id)?._count
                    ._all ?? 0;
                const percent =
                  batch.totalClaims === 0
                    ? 0
                    : Math.round((green / batch.totalClaims) * 100);

                return (
                  <tr key={batch.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/ar/batches/${batch.id}`}
                        className="font-medium text-slate-900 hover:text-brand-700"
                      >
                        {MONTH_NAMES[batch.reportMonth - 1]} {batch.reportYear}
                      </Link>
                      {batch.insuranceName ? (
                        <span className="ml-2 text-xs text-slate-500">
                          {batch.insuranceName}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          batch.status === BatchStatus.OPEN ? "brand" : "neutral"
                        }
                      >
                        {batch.status === BatchStatus.OPEN ? "Open" : "Closed"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {batch.totalClaims}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                      {formatUSD(batch.totalBalance.toString())}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {percent}%
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {batch.uploadedBy.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDateIST(batch.uploadedAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {batch.closedAt ? (
                        <>
                          {formatDate(batch.closedAt)}
                          <span className="block text-xs text-slate-400">
                            {batch.closedBy?.name}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
