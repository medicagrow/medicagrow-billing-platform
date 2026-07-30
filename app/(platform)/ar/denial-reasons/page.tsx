import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/Card";
import { canManageBatches } from "@/lib/ar-access";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Denial Reasons" };
export const dynamic = "force-dynamic";

export default async function DenialReasonsPage() {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const reasons = await prisma.arDenialReason.findMany({
    orderBy: [{ usageCount: "desc" }, { reason: "asc" }],
    take: 200,
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Denial Reasons"
        description="This list builds itself from what billers actually enter. Read-only."
      />

      {reasons.length === 0 ? (
        <EmptyState
          title="No denial reasons recorded yet"
          description="Reasons are added automatically the first time a biller logs a denial."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 text-right">Times used</th>
                <th className="px-4 py-3">Last used</th>
                <th className="px-4 py-3">First recorded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reasons.map((reason) => (
                <tr key={reason.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {reason.reason}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {reason.usageCount}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {reason.lastUsedAt ? formatDate(reason.lastUsedAt) : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(reason.createdAt)}
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
