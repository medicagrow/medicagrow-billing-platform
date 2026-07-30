"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgingBadge } from "@/components/ar/AgingBadge";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/toast";
import { AGING_BUCKETS } from "@/lib/ar-aging";
import type { ClaimDto } from "@/lib/ar-serialize";
import { formatDate, formatUSD } from "@/lib/format";

type TabKey = "all" | "unassigned" | "blue" | "overdue";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All Claims" },
  { key: "unassigned", label: "Unassigned" },
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
}: {
  batchId: string;
  canAssign: boolean;
  batchClosed: boolean;
  assignees: Assignee[];
  insuranceOptions: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>("all");
  const [claims, setClaims] = useState<ClaimDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [insuranceFilter, setInsuranceFilter] = useState("");
  const [agingFilter, setAgingFilter] = useState("");

  const pageSize = 50;

  const query = useMemo(() => {
    const params = new URLSearchParams({
      batchId,
      page: String(page),
      pageSize: String(pageSize),
    });

    if (tab === "unassigned") params.set("unassigned", "true");
    if (tab === "blue") params.set("statusCategory", "BLUE");
    if (tab === "overdue") params.set("overdue", "true");
    if (insuranceFilter) params.set("insuranceName", insuranceFilter);
    if (agingFilter) params.set("agingBucket", agingFilter);

    return params.toString();
  }, [batchId, page, tab, insuranceFilter, agingFilter]);

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

  useEffect(() => {
    setSelected(new Set());
  }, [tab, page, insuranceFilter, agingFilter]);

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
        <Select
          value={insuranceFilter}
          onChange={(event) => {
            setInsuranceFilter(event.target.value);
            setPage(1);
          }}
          className="w-auto min-w-[180px]"
        >
          <option value="">All insurances</option>
          {insuranceOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>

        <Select
          value={agingFilter}
          onChange={(event) => {
            setAgingFilter(event.target.value);
            setPage(1);
          }}
          className="w-auto min-w-[150px]"
        >
          <option value="">All ages</option>
          {AGING_BUCKETS.map((bucket) => (
            <option key={bucket.key} value={bucket.key}>
              {bucket.label}
            </option>
          ))}
        </Select>

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
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Insurance</th>
                  <th className="px-4 py-3">DOS</th>
                  <th className="px-4 py-3">CPT</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Aging</th>
                  <th className="px-4 py-3">Status</th>
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
                        {formatDate(claim.dateOfService)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {claim.cptCode ?? "—"}
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

          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>
              {total} claim{total === 1 ? "" : "s"} · page {page} of{" "}
              {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
