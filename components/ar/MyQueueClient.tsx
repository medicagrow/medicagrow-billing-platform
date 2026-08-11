"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AgingBadge } from "@/components/ar/AgingBadge";
import { StatusBadge } from "@/components/ar/StatusBadge";
import {
  isPageSize,
  Pagination,
  PAGE_SIZE_OPTIONS,
} from "@/components/ui/Pagination";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { Select } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import type { ClaimDto } from "@/lib/ar-serialize";
import { hasActiveFilters, useFilterState } from "@/lib/hooks/useFilterState";
import { useLocalSetting } from "@/lib/hooks/useLocalSetting";
import { NOT_ACTIONABLE_MAX_DAYS } from "@/lib/ar-actionable";
import { GREEN_STATUSES, RED_STATUSES } from "@/lib/ar-status";
import { usePractice } from "@/lib/contexts/PracticeContext";
import { formatDate, formatUSD } from "@/lib/format";
import { formatDateIST } from "@/lib/timezone";

/** The first of the shared page sizes — 50 rows. */
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0]!;

interface Reassignment {
  reassignedByName: string;
  reassignedById: string;
  reassignedAt: string;
  note: string;
}

type QueueClaim = ClaimDto & {
  practiceId: string;
  practiceName: string;
  reportMonth: number;
  reportYear: number;
  reassignment: Reassignment | null;
};

type SortKey = "agingDays" | "balance" | "followUpDate" | "patientName";

type ViewKey = "active" | "completed" | "reassigned";

/** What every filter reads as when nothing is chosen. */
const FILTER_DEFAULTS = {
  view: "active",
  practiceId: "",
  insurance: [] as string[],
  statusLabel: "",
  visitStatus: "",
  search: "",
  followUpFrom: "",
  followUpTo: "",
  /** Off by default: a claim under 30 days old is not work yet. */
  includeNotActionable: false,
  sort: "agingDays",
  dir: "desc",
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
};

export function MyQueueClient({
  practices,
  insuranceOptions,
  visitStatusOptions,
  isManager,
}: {
  practices: { id: string; name: string }[];
  /** Distinct values across everything assigned to this person. */
  insuranceOptions: string[];
  /**
   * Empty when no claim in their book carries a visit status — the filter is
   * then not rendered at all, rather than promising data that is not there.
   */
  visitStatusOptions: string[];
  /** Only a manager has people who can hand work back to them. */
  isManager: boolean;
}) {
  // The top-bar selector is the global filter; the local dropdown narrows
  // further within it.
  const { selectedPracticeId } = usePractice();
  const [claims, setClaims] = useState<QueueClaim[]>([]);
  const [summary, setSummary] = useState({
    totalClaims: 0,
    totalBalance: "0.00",
    overdueCount: 0,
    completedThisMonth: 0,
  });
  const [counts, setCounts] = useState({
    active: 0,
    completed: 0,
    reassigned: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);

  // The queue is a working list, so its filters live in the URL — coming back
  // from a claim should return to the same queue, not a reset one.
  const [filters, setFilters, clearFilters] = useFilterState(FILTER_DEFAULTS, {
    debounced: ["search"],
    pageKey: "page",
  });

  const {
    practiceId,
    statusLabel,
    visitStatus,
    search,
    followUpFrom,
    followUpTo,
    includeNotActionable,
    page,
  } = filters;

  const view = filters.view as ViewKey;
  const pageSize = filters.limit;

  // The view, the sort and the page are how you move through the queue rather
  // than narrow it, so they do not light up "clear all filters".
  const filtersActive = hasActiveFilters(filters, FILTER_DEFAULTS, [
    "view",
    "sort",
    "dir",
    "page",
    "limit",
  ]);

  const sortKey = filters.sort as SortKey;
  const sortAsc = filters.dir === "asc";

  const [storedPageSize, setStoredPageSize] = useLocalSetting(
    "ar.myQueue.pageSize",
    DEFAULT_PAGE_SIZE,
    isPageSize,
  );

  // Remembered per browser, but a URL naming a size wins so a shared link
  // opens the view the sender saw.
  const appliedStoredSize = useRef(false);

  useEffect(() => {
    if (appliedStoredSize.current) return;
    appliedStoredSize.current = true;

    const named = new URLSearchParams(window.location.search).has("limit");
    if (!named && storedPageSize !== DEFAULT_PAGE_SIZE) {
      setFilters({ limit: storedPageSize });
    }
  }, [storedPageSize, setFilters]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      view,
      page: String(page),
      pageSize: String(pageSize),
    });
    // Local dropdown wins when set; otherwise fall back to the global filter.
    const effectivePracticeId = practiceId || selectedPracticeId;

    if (effectivePracticeId) params.set("practiceId", effectivePracticeId);
    if (filters.insurance.length > 0) {
      params.set("insuranceNames", filters.insurance.join(","));
    }
    if (statusLabel) params.set("statusLabel", statusLabel);
    if (visitStatus) params.set("visitStatus", visitStatus);
    if (search.trim()) params.set("search", search.trim());
    if (followUpFrom) params.set("followUpFrom", followUpFrom);
    if (followUpTo) params.set("followUpTo", followUpTo);
    if (includeNotActionable) params.set("includeNotActionable", "true");

    return params.toString();
  }, [
    view,
    page,
    pageSize,
    practiceId,
    selectedPracticeId,
    filters.insurance,
    statusLabel,
    visitStatus,
    search,
    followUpFrom,
    followUpTo,
    includeNotActionable,
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
      setCounts(payload.counts);
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
    if (key === sortKey) setFilters({ dir: sortAsc ? "desc" : "asc" });
    else {
      setFilters({
        sort: key,
        dir: key === "followUpDate" || key === "patientName" ? "asc" : "desc",
      });
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

  const TABS: { key: ViewKey; label: string; count: number; tone?: string }[] = [
    { key: "active", label: "Active", count: counts.active },
    { key: "completed", label: "Completed", count: counts.completed },
    ...(isManager
      ? [
          {
            key: "reassigned" as ViewKey,
            label: "Reassigned to me",
            count: counts.reassigned,
            tone: "amber",
          },
        ]
      : []),
  ];

  return (
    <div>
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            {view === "completed" ? "Completed claims" : "Claims in queue"}
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Completed this month
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">
            {summary.completedThisMonth}
          </p>
        </div>
      </div>

      {/*
        A manager who also works claims sees what has been handed back to them
        before anything else — it is somebody waiting on an answer, which is
        more urgent than their own queue.
      */}
      {isManager && counts.reassigned > 0 && view !== "reassigned" ? (
        <button
          type="button"
          onClick={() => setFilters({ view: "reassigned" })}
          className="mb-4 flex w-full items-center justify-between rounded-lg bg-amber-50 px-4 py-2.5 text-left text-sm text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
        >
          <span>
            <span className="font-semibold">
              Claims reassigned to you — {counts.reassigned} pending
            </span>
            <span className="ml-2 text-xs text-amber-700">
              blue-status escalations and claims a biller handed back
            </span>
          </span>
          <span className="text-xs font-medium underline">View</span>
        </button>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-slate-200">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setFilters({ view: entry.key })}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              view === entry.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {entry.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                entry.count === 0
                  ? "bg-slate-100 text-slate-500"
                  : entry.tone === "amber"
                    ? "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200"
                    : "bg-slate-100 text-slate-700"
              }`}
            >
              {entry.count}
            </span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Select
          value={practiceId}
          onChange={(event) => {
            setFilters({ practiceId: event.target.value });
          }}
          className="w-auto min-w-[170px]"
          aria-label="Practice"
        >
          <option value="">All practices</option>
          {practices.map((practice) => (
            <option key={practice.id} value={practice.id}>
              {practice.name}
            </option>
          ))}
        </Select>

        <MultiSelectDropdown
          options={insuranceOptions.map((name) => ({
            label: name,
            value: name,
          }))}
          selected={filters.insurance}
          onChange={(next) => setFilters({ insurance: next })}
          placeholder="All insurances"
          allLabel="All Insurances"
          noun="insurances"
          aria-label="Insurance"
          className="w-auto min-w-[190px]"
        />

        {/* The status list follows the tab: a completed claim is never red. */}
        <Select
          value={statusLabel}
          onChange={(event) => {
            setFilters({ statusLabel: event.target.value });
          }}
          className="w-auto min-w-[160px]"
          aria-label="Status"
        >
          <option value="">
            {view === "completed" ? "All green statuses" : "All statuses"}
          </option>
          {(view === "completed" ? GREEN_STATUSES : RED_STATUSES).map(
            (status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ),
          )}
        </Select>

        {/*
          Only rendered when something in this person's book actually carries a
          visit status — an empty dropdown promises data that is not there.
        */}
        {visitStatusOptions.length > 0 ? (
          <Select
            value={visitStatus}
            onChange={(event) => setFilters({ visitStatus: event.target.value })}
            className="w-auto min-w-[160px]"
            aria-label="Visit status"
          >
            <option value="">All visit statuses</option>
            {visitStatusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        ) : null}

        <Input
          type="search"
          value={search}
          onChange={(event) => setFilters({ search: event.target.value })}
          placeholder="Search patient name, CPT or Visit ID..."
          aria-label="Search patient name, CPT or Visit ID"
          className="w-auto min-w-[220px]"
        />

        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">
            {view === "completed" ? "Completed" : "Follow-up"}
          </span>
          <Input
            type="date"
            value={followUpFrom}
            max={followUpTo || undefined}
            onChange={(event) => {
              setFilters({ followUpFrom: event.target.value });
            }}
            className="w-auto"
            aria-label={
              view === "completed" ? "Completed from" : "Follow-up from"
            }
          />
          <span className="text-xs text-slate-400">to</span>
          <Input
            type="date"
            value={followUpTo}
            min={followUpFrom || undefined}
            onChange={(event) => {
              setFilters({ followUpTo: event.target.value });
            }}
            className="w-auto"
            aria-label={view === "completed" ? "Completed to" : "Follow-up to"}
          />
        </div>

        {/*
          0–30 day claims are out of the queue because insurance has not had
          time to process them. The toggle is for a biller with a clear queue
          who wants to look ahead.
        */}
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={includeNotActionable}
            onChange={(event) =>
              setFilters({ includeNotActionable: event.target.checked })
            }
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
          />
          Show 0–{NOT_ACTIONABLE_MAX_DAYS} day claims
        </label>

        {filtersActive ? (
          <Button
            variant="secondary"
            className="px-3 py-2 text-xs"
            onClick={clearFilters}
          >
            Clear all filters
          </Button>
        ) : null}
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
          title={
            view === "completed"
              ? "Nothing completed yet in this period"
              : view === "reassigned"
                ? "Nothing has been handed to you"
                : "Your queue is empty — no pending claims assigned to you"
          }
          description={
            view === "completed"
              ? "Claims appear here once you move them to a green status."
              : view === "reassigned"
                ? "Blue-status escalations and claims a biller reassigns to you land here."
                : "Claims appear here when a project manager assigns you red-status work."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
            <table className="w-full min-w-[1040px] text-sm">
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
                    {view === "completed" ? (
                      "Completed"
                    ) : (
                      <SortHeader label="Follow-up" sortAs="followUpDate" />
                    )}
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
                        {/*
                          How this claim reached the manager, and the note the
                          biller left with it — the context that saves opening
                          the claim to find out why it came back.
                        */}
                        {claim.reassignment ? (
                          <span className="mt-0.5 block text-xs text-amber-700">
                            ↩ Reassigned by {claim.reassignment.reassignedByName}
                            <span className="block text-slate-500">
                              {claim.reassignment.note.length > 90
                                ? `${claim.reassignment.note.slice(0, 90)}…`
                                : claim.reassignment.note}
                            </span>
                          </span>
                        ) : view === "reassigned" &&
                          claim.statusCategory === "BLUE" ? (
                          <span className="mt-0.5 block text-xs text-sky-700">
                            Escalated by blue status
                          </span>
                        ) : null}
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
                        {view === "completed" ? (
                          <span className="text-slate-600">
                            {/*
                              A completion is a moment, not a calendar date, so
                              it reads in IST like every other timestamp.
                            */}
                            {formatDateIST(claim.lastWorkedAt)}
                          </span>
                        ) : claim.followUpDate ? (
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
            onPageChange={(next) => setFilters({ page: next })}
            onPageSizeChange={(size) => {
              setStoredPageSize(size);
              setFilters({ limit: size, page: 1 });
            }}
            noun="claims"
            filtered={filtersActive}
          />
        </>
      )}
    </div>
  );
}
