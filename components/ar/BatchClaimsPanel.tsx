"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgingBadge } from "@/components/ar/AgingBadge";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { isPageSize, Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { SettingsIcon } from "@/components/ui/icons";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/toast";
import { AGING_BUCKETS } from "@/lib/ar-aging";
import { isBoolean, useLocalSetting } from "@/lib/hooks/useLocalSetting";
import type { ClaimDto } from "@/lib/ar-serialize";
import { formatDate, formatUSD } from "@/lib/format";

export type TabKey = "all" | "unassigned" | "red" | "blue" | "overdue";

type SortKey = "aging" | "patientName" | "provider" | "balance" | "status";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All Claims" },
  { key: "unassigned", label: "Unassigned" },
  { key: "red", label: "Red Claims" },
  { key: "blue", label: "Blue Claims" },
  { key: "overdue", label: "Overdue Follow-ups" },
];

interface Assignee {
  id: string;
  name: string;
  role: string;
}

export function BatchClaimsPanel({
  batchId,
  canAssign,
  batchClosed,
  assignees,
  insuranceOptions,
  providerOptions,
  initialTab = "all",
}: {
  batchId: string;
  canAssign: boolean;
  batchClosed: boolean;
  assignees: Assignee[];
  insuranceOptions: string[];
  /** Both provider fields, merged — the column shows whichever it has. */
  providerOptions: string[];
  /** Seeded from the URL, so a dashboard count lands on what it counted. */
  initialTab?: TabKey;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>(initialTab);
  const [claims, setClaims] = useState<ClaimDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("aging");
  const [ascending, setAscending] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);
  /**
   * Optional columns, off by default. Most batches carry neither field, and a
   * column of dashes costs width the columns people actually read need.
   */
  const [showVisitId, setShowVisitId] = useLocalSetting(
    "ar.claims.showVisitId",
    false,
    isBoolean,
  );
  const [showVisitStatus, setShowVisitStatus] = useLocalSetting(
    "ar.claims.showVisitStatus",
    false,
    isBoolean,
  );
  const [columnsOpen, setColumnsOpen] = useState(false);

  const [pageSize, setPageSize] = useLocalSetting(
    "ar.claims.pageSize",
    50,
    isPageSize,
  );

  const [insuranceFilter, setInsuranceFilter] = useState<string[]>([]);
  const [agingFilter, setAgingFilter] = useState<string[]>([]);
  const [providerFilter, setProviderFilter] = useState<string[]>([]);
  const [dosFrom, setDosFrom] = useState("");
  const [dosTo, setDosTo] = useState("");

  /**
   * Typed search is debounced: `search` is what the box shows, `debouncedSearch`
   * is what the query uses. Firing on every keystroke would put a request in
   * flight per character and let a slow one land after a faster later one.
   */
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      batchId,
      page: String(page),
      pageSize: String(pageSize),
    });

    if (tab === "unassigned") params.set("unassigned", "true");
    if (tab === "red") params.set("statusCategory", "RED");
    if (tab === "blue") params.set("statusCategory", "BLUE");
    if (tab === "overdue") params.set("overdue", "true");
    // Empty means "no filter", so the params are omitted entirely.
    if (insuranceFilter.length > 0) {
      params.set("insuranceNames", insuranceFilter.join(","));
    }
    if (agingFilter.length > 0) {
      params.set("agingBuckets", agingFilter.join(","));
    }
    if (providerFilter.length > 0) {
      params.set("providerNames", providerFilter.join(","));
    }
    if (dosFrom) params.set("dosFrom", dosFrom);
    if (dosTo) params.set("dosTo", dosTo);
    if (debouncedSearch) params.set("search", debouncedSearch);
    params.set("sort", sortKey);
    params.set("direction", ascending ? "asc" : "desc");

    return params.toString();
  }, [
    batchId,
    page,
    pageSize,
    tab,
    insuranceFilter,
    agingFilter,
    providerFilter,
    dosFrom,
    dosTo,
    debouncedSearch,
    sortKey,
    ascending,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/ar/claims?${query}`);
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not load claims.");
        setClaims([]);
        return;
      }

      setClaims(payload.data);
      setTotal(payload.pagination.total);
    } catch {
      setError("Could not load claims. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  // A changed filter changes which rows exist, so a selection made against
  // the old set is no longer meaningful.
  useEffect(() => {
    setSelected(new Set());
  }, [
    tab,
    page,
    insuranceFilter,
    agingFilter,
    providerFilter,
    dosFrom,
    dosTo,
    debouncedSearch,
  ]);

  const filtersActive =
    insuranceFilter.length > 0 ||
    agingFilter.length > 0 ||
    providerFilter.length > 0 ||
    dosFrom !== "" ||
    dosTo !== "" ||
    search !== "";

  function clearFilters() {
    setInsuranceFilter([]);
    setAgingFilter([]);
    setProviderFilter([]);
    setDosFrom("");
    setDosTo("");
    setSearch("");
    setPage(1);
  }

  const allOnPageSelected =
    claims.length > 0 && claims.every((claim) => selected.has(claim.id));

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) {
        claims.forEach((claim) => next.delete(claim.id));
      } else {
        claims.forEach((claim) => next.add(claim.id));
      }
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkAssign() {
    if (selected.size === 0 || !assignTo) return;

    setAssigning(true);

    try {
      const response = await fetch("/api/ar/claims/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimIds: Array.from(selected),
          assignedToId: assignTo === "__unassign__" ? null : assignTo,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast(payload?.error ?? "Assignment failed.", "error");
        return;
      }

      toast(
        `${payload.updated} claim${payload.updated === 1 ? "" : "s"} assigned`,
      );
      setSelected(new Set());
      setAssignTo("");
      await load();
      router.refresh();
    } catch {
      toast("Assignment failed. Check your connection.", "error");
    } finally {
      setAssigning(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // A bigger page can leave the cursor past the end of the list.
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const SortHeader = ({
    label,
    sortAs,
  }: {
    label: string;
    sortAs: SortKey;
  }) => (
    <button
      type="button"
      onClick={() => {
        if (sortKey === sortAs) setAscending((current) => !current);
        else {
          setSortKey(sortAs);
          // Aging reads newest-first; names and amounts read ascending.
          setAscending(sortAs !== "aging");
        }
        setPage(1);
      }}
      className="inline-flex items-center gap-1 hover:text-slate-800"
    >
      {label}
      {sortKey === sortAs ? <span>{ascending ? "▲" : "▼"}</span> : null}
    </button>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-slate-200">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              setTab(entry.key);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === entry.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MultiSelectDropdown
          options={insuranceOptions.map((name) => ({
            label: name,
            value: name,
          }))}
          selected={insuranceFilter}
          onChange={(next) => {
            setInsuranceFilter(next);
            setPage(1);
          }}
          placeholder="All insurances"
          allLabel="All Insurances"
          noun="insurances"
          aria-label="Insurance"
          className="w-auto min-w-[200px]"
        />

        <MultiSelectDropdown
          options={AGING_BUCKETS.map((bucket) => ({
            label: bucket.label,
            value: bucket.key,
          }))}
          selected={agingFilter}
          onChange={(next) => {
            setAgingFilter(next);
            setPage(1);
          }}
          placeholder="All ages"
          allLabel="All Ages"
          noun="buckets"
          aria-label="Aging"
          className="w-auto min-w-[180px]"
        />

        <MultiSelectDropdown
          options={providerOptions.map((name) => ({
            label: name,
            value: name,
          }))}
          selected={providerFilter}
          onChange={(next) => {
            setProviderFilter(next);
            setPage(1);
          }}
          placeholder="All providers"
          allLabel="All Providers"
          noun="providers"
          aria-label="Provider"
          className="w-auto min-w-[200px]"
        />

        <div className="flex items-center gap-1.5">
          <label htmlFor="dosFrom" className="text-xs text-slate-500">
            DOS
          </label>
          <Input
            id="dosFrom"
            type="date"
            value={dosFrom}
            max={dosTo || undefined}
            onChange={(event) => {
              setDosFrom(event.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Date of service from"
          />
          <span className="text-xs text-slate-400">to</span>
          <Input
            id="dosTo"
            type="date"
            value={dosTo}
            min={dosFrom || undefined}
            onChange={(event) => {
              setDosTo(event.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Date of service to"
          />
        </div>

        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search patient name or CPT..."
          aria-label="Search patient name or CPT"
          className="w-auto min-w-[220px]"
        />

        {filtersActive ? (
          <Button
            variant="secondary"
            className="px-3 py-2 text-xs"
            onClick={clearFilters}
          >
            Clear all filters
          </Button>
        ) : null}

        <div className="relative">
          <Button
            variant="secondary"
            className="px-3 py-2 text-xs"
            onClick={() => setColumnsOpen((open) => !open)}
            aria-expanded={columnsOpen}
            aria-haspopup="true"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Columns
          </Button>

          {columnsOpen ? (
            <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Optional columns
              </p>
              <label className="flex items-center gap-2 rounded px-1 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={showVisitId}
                  onChange={(event) => setShowVisitId(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Visit ID
              </label>
              <label className="flex items-center gap-2 rounded px-1 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={showVisitStatus}
                  onChange={(event) => setShowVisitStatus(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Visit Status
              </label>
            </div>
          ) : null}
        </div>

        {canAssign && !batchClosed ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {selected.size} selected
            </span>
            <Select
              value={assignTo}
              onChange={(event) => setAssignTo(event.target.value)}
              disabled={selected.size === 0 || assigning}
              className="w-auto min-w-[200px]"
            >
              <option value="">Assign selected to…</option>
              {assignees.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
              <option value="__unassign__">— Unassign —</option>
            </Select>
            <Button
              onClick={handleBulkAssign}
              disabled={selected.size === 0 || !assignTo || assigning}
              className="px-3 py-2 text-xs"
            >
              {assigning ? "Assigning…" : "Apply"}
            </Button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <TableSkeleton rows={8} columns={8} />
      ) : error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-100">
          {error}
          <button
            type="button"
            onClick={load}
            className="ml-2 font-medium underline"
          >
            Retry
          </button>
        </div>
      ) : claims.length === 0 ? (
        <EmptyState
          title={
            tab === "unassigned"
              ? "Every claim is assigned"
              : tab === "blue"
                ? "No blue claims"
                : tab === "overdue"
                  ? "No overdue follow-ups"
                  : "No claims match these filters"
          }
          description={
            tab === "all"
              ? "Adjust the insurance or aging filter to see more."
              : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  {canAssign && !batchClosed ? (
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                        aria-label="Select all on this page"
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-3">
                    <SortHeader label="Patient" sortAs="patientName" />
                  </th>
                  <th className="px-4 py-3">Insurance</th>
                  <th className="px-4 py-3">
                    <SortHeader label="Provider" sortAs="provider" />
                  </th>
                  <th className="px-4 py-3">DOS</th>
                  <th className="px-4 py-3">CPT</th>
                  {showVisitId ? (
                    <th className="px-4 py-3">Visit ID</th>
                  ) : null}
                  {showVisitStatus ? (
                    <th className="px-4 py-3">Visit Status</th>
                  ) : null}
                  <th className="px-4 py-3 text-right">
                    <SortHeader label="Balance" sortAs="balance" />
                  </th>
                  <th className="px-4 py-3 text-right">
                    <SortHeader label="Aging" sortAs="aging" />
                  </th>
                  <th className="px-4 py-3">
                    <SortHeader label="Status" sortAs="status" />
                  </th>
                  <th className="px-4 py-3">Assigned to</th>
                  <th className="px-4 py-3">Follow-up</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {claims.map((claim) => {
                  const overdue =
                    claim.followUpDate !== null &&
                    new Date(claim.followUpDate) < new Date() &&
                    claim.statusCategory === "RED";

                  return (
                    <tr key={claim.id} className="hover:bg-slate-50">
                      {canAssign && !batchClosed ? (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(claim.id)}
                            onChange={() => toggleOne(claim.id)}
                            aria-label={`Select ${claim.patientName}`}
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                          />
                        </td>
                      ) : null}
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
                        {/* renderingProvider is the specific name; providerName
                            is what the import carried. */}
                        {claim.renderingProvider ??
                          claim.providerName ?? (
                            <span className="text-slate-400">—</span>
                          )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(claim.dateOfService)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {claim.cptCode ?? "—"}
                      </td>
                      {showVisitId ? (
                        <td className="px-4 py-3 text-slate-600">
                          {claim.visitId ?? (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      ) : null}
                      {showVisitStatus ? (
                        <td className="px-4 py-3 text-slate-600">
                          {claim.visitStatus ?? (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      ) : null}
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
                        {claim.assignedToName ?? (
                          <Badge variant="amber">Unassigned</Badge>
                        )}
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
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/ar/claims/${claim.id}`}
                          className="text-xs font-medium text-brand-700 hover:text-brand-800"
                        >
                          View
                        </Link>
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
            totalItems={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            noun="claims"
            filtered={filtersActive}
          />
        </>
      )}
    </div>
  );
}
