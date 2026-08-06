"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AgingBadge } from "@/components/ar/AgingBadge";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { isPageSize, Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import type { ClaimDto } from "@/lib/ar-serialize";
import { useLocalSetting } from "@/lib/hooks/useLocalSetting";
import { RED_STATUSES } from "@/lib/ar-status";
import { usePractice } from "@/lib/contexts/PracticeContext";
import { formatDate, formatUSD } from "@/lib/format";

type QueueClaim = ClaimDto & {
  practiceId: string;
  practiceName: string;
  reportMonth: number;
  reportYear: number;
};

type SortKey = "agingDays" | "balance" | "followUpDate" | "patientName";

export function MyQueueClient({
  practices,
}: {
  practices: { id: string; name: string }[];
}) {
  // The top-bar selector is the global filter; the local dropdown narrows
  // further within it.
  const { selectedPracticeId } = usePractice();
  const [claims, setClaims] = useState<QueueClaim[]>([]);
  const [summary, setSummary] = useState({
    totalClaims: 0,
    totalBalance: "0.00",
    overdueCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useLocalSetting(
    "ar.myQueue.pageSize",
    50,
    isPageSize,
  );

  const [practiceId, setPracticeId] = useState("");
  const [insuranceName, setInsuranceName] = useState("");
  const [statusLabel, setStatusLabel] = useState("");
  const [followUpFrom, setFollowUpFrom] = useState("");
  const [followUpTo, setFollowUpTo] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("agingDays");
  const [sortAsc, setSortAsc] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    // Local dropdown wins when set; otherwise fall back to the global filter.
    const effectivePracticeId = practiceId || selectedPracticeId;

    if (effectivePracticeId) params.set("practiceId", effectivePracticeId);
    if (insuranceName) params.set("insuranceName", insuranceName);
    if (statusLabel) params.set("statusLabel", statusLabel);
    if (followUpFrom) params.set("followUpFrom", followUpFrom);
    if (followUpTo) params.set("followUpTo", followUpTo);
    return params.toString();
  }, [
    page,
    pageSize,
    practiceId,
    selectedPracticeId,
    insuranceName,
    statusLabel,
    followUpFrom,
    followUpTo,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/ar/claims/my-queue?${query}`);
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not load your queue.");
        return;
      }

      setClaims(payload.data);
      setSummary(payload.summary);
      setTotalPages(payload.pagination.totalPages);
    } catch {
      setError("Could not load your queue. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  /** Client-side reorder of the current page — the API enforces the default. */
  const sorted = useMemo(() => {
    const copy = [...claims];
    copy.sort((a, b) => {
      let comparison = 0;

      if (sortKey === "agingDays") comparison = a.agingDays - b.agingDays;
      else if (sortKey === "balance")
        comparison = Number(a.balance) - Number(b.balance);
      else if (sortKey === "patientName")
        comparison = a.patientName.localeCompare(b.patientName);
      else {
        const aTime = a.followUpDate ? new Date(a.followUpDate).getTime() : Infinity;
        const bTime = b.followUpDate ? new Date(b.followUpDate).getTime() : Infinity;
        comparison = aTime - bTime;
      }

      return sortAsc ? comparison : -comparison;
    });
    return copy;
  }, [claims, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortAsc((current) => !current);
    else {
      setSortKey(key);
      setSortAsc(key === "followUpDate" || key === "patientName");
    }
  }

  const SortHeader = ({ label, sortAs }: { label: string; sortAs: SortKey }) => (
    <button
      type="button"
      onClick={() => toggleSort(sortAs)}
      className="inline-flex items-center gap-1 hover:text-slate-800"
    >
      {label}
      {sortKey === sortAs ? <span>{sortAsc ? "▲" : "▼"}</span> : null}
    </button>
  );

  const today = new Date();

  return (
    <div>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Claims in queue
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {summary.totalClaims}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Total balance
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {formatUSD(summary.totalBalance)}
          </p>
        </div>
        <div
          className={`rounded-xl border p-4 shadow-card ${
            summary.overdueCount > 0
              ? "border-red-200 bg-red-50"
              : "border-slate-200 bg-white"
          }`}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Overdue follow-ups
          </p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              summary.overdueCount > 0 ? "text-red-700" : "text-slate-900"
            }`}
          >
            {summary.overdueCount}
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Select
          value={practiceId}
          onChange={(event) => {
            setPracticeId(event.target.value);
            setPage(1);
          }}
          className="w-auto min-w-[170px]"
        >
          <option value="">All practices</option>
          {practices.map((practice) => (
            <option key={practice.id} value={practice.id}>
              {practice.name}
            </option>
          ))}
        </Select>

        <Input
          value={insuranceName}
          onChange={(event) => {
            setInsuranceName(event.target.value);
            setPage(1);
          }}
          placeholder="Filter by insurance"
          className="w-auto min-w-[170px]"
        />

        <Select
          value={statusLabel}
          onChange={(event) => {
            setStatusLabel(event.target.value);
            setPage(1);
          }}
          className="w-auto min-w-[160px]"
        >
          <option value="">All red statuses</option>
          {RED_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>

        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={followUpFrom}
            onChange={(event) => {
              setFollowUpFrom(event.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Follow-up from"
          />
          <span className="text-xs text-slate-400">to</span>
          <Input
            type="date"
            value={followUpTo}
            onChange={(event) => {
              setFollowUpTo(event.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Follow-up to"
          />
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={8} columns={8} />
      ) : error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-100">
          {error}
          <button type="button" onClick={load} className="ml-2 font-medium underline">
            Retry
          </button>
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          title="Your queue is empty — no pending claims assigned to you"
          description="Claims appear here when a project manager assigns you red-status work."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">
                    <SortHeader label="Patient" sortAs="patientName" />
                  </th>
                  <th className="px-4 py-3">Insurance</th>
                  <th className="px-4 py-3">DOS</th>
                  <th className="px-4 py-3 text-right">
                    <SortHeader label="Balance" sortAs="balance" />
                  </th>
                  <th className="px-4 py-3 text-right">
                    <SortHeader label="Aging" sortAs="agingDays" />
                  </th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Practice</th>
                  <th className="px-4 py-3">
                    <SortHeader label="Follow-up" sortAs="followUpDate" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((claim) => {
                  const overdue =
                    claim.followUpDate !== null &&
                    new Date(claim.followUpDate) < today;

                  return (
                    <tr key={claim.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/ar/claims/${claim.id}`}
                          className="font-medium text-slate-900 hover:text-brand-700"
                        >
                          {claim.patientName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {claim.insuranceName}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(claim.dateOfService)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                        {formatUSD(claim.balance)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <AgingBadge days={claim.agingDays} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={claim.statusLabel}
                          category={claim.statusCategory}
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {claim.practiceName}
                      </td>
                      <td className="px-4 py-3">
                        {claim.followUpDate ? (
                          <span
                            className={
                              overdue
                                ? "font-medium text-red-600"
                                : "text-slate-600"
                            }
                          >
                            {formatDate(claim.followUpDate)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={summary.totalClaims}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            noun="claims"
            filtered={Boolean(
              practiceId || insuranceName || statusLabel || followUpFrom || followUpTo,
            )}
          />
        </>
      )}
    </div>
  );
}
