"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { NOT_ACTIONABLE_MAX_DAYS } from "@/lib/ar-actionable";
import type {
  CategoryFilter,
  InsuranceAgingByCategory,
  InsuranceAgingRow,
} from "@/lib/ar-insurance-aging";
import { formatUSD } from "@/lib/format";
import { centsToDecimalString, toCents } from "@/lib/money";

type SortKey =
  | "insuranceName"
  | "bucket0_30"
  | "bucket31_60"
  | "bucket61_90"
  | "bucket90plus"
  | "totalClaims"
  | "totalBalance";

const BUCKET_COLUMNS: {
  key: Extract<SortKey, `bucket${string}`>;
  label: string;
  cell: string;
}[] = [
  { key: "bucket0_30", label: "0–30 Days", cell: "bg-emerald-50" },
  { key: "bucket31_60", label: "31–60 Days", cell: "bg-amber-50" },
  { key: "bucket61_90", label: "61–90 Days", cell: "bg-orange-50" },
  { key: "bucket90plus", label: "90+ Days", cell: "bg-red-50" },
];

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "RED", label: "Red only" },
  { value: "BLUE", label: "Blue only" },
  { value: "GREEN", label: "Green only" },
];

function exportCsv(rows: InsuranceAgingRow[]) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const header = [
    "Insurance Name",
    "0-30 Claims", "0-30 Balance",
    "31-60 Claims", "31-60 Balance",
    "61-90 Claims", "61-90 Balance",
    "90+ Claims", "90+ Balance",
    "Total Claims", "Total Balance",
  ].join(",");

  const body = rows.map((row) =>
    [
      escape(row.insuranceName),
      row.bucket0_30.claims, row.bucket0_30.balance,
      row.bucket31_60.claims, row.bucket31_60.balance,
      row.bucket61_90.claims, row.bucket61_90.balance,
      row.bucket90plus.claims, row.bucket90plus.balance,
      row.totalClaims, row.totalBalance,
    ].join(","),
  );

  const url = URL.createObjectURL(
    new Blob([[header, ...body].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );

  const link = document.createElement("a");
  link.href = url;
  link.download = "insurance-aging.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function InsuranceAgingTable({
  data,
}: {
  data: InsuranceAgingByCategory;
}) {
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalBalance");
  const [ascending, setAscending] = useState(false);

  const rows = useMemo(() => {
    const source = data[category] ?? [];
    const term = search.trim().toLowerCase();

    const filtered = term
      ? source.filter((row) => row.insuranceName.toLowerCase().includes(term))
      : [...source];

    filtered.sort((a, b) => {
      let comparison = 0;

      if (sortKey === "insuranceName") {
        comparison = a.insuranceName.localeCompare(b.insuranceName);
      } else if (sortKey === "totalClaims") {
        comparison = a.totalClaims - b.totalClaims;
      } else if (sortKey === "totalBalance") {
        const difference = toCents(a.totalBalance) - toCents(b.totalBalance);
        comparison = difference > 0n ? 1 : difference < 0n ? -1 : 0;
      } else {
        const difference =
          toCents(a[sortKey].balance) - toCents(b[sortKey].balance);
        comparison = difference > 0n ? 1 : difference < 0n ? -1 : 0;
      }

      return ascending ? comparison : -comparison;
    });

    return filtered;
  }, [data, category, search, sortKey, ascending]);

  // Pinned totals reflect exactly what is on screen.
  const totals = useMemo(() => {
    const bucketCents: Record<string, bigint> = {};
    const bucketClaims: Record<string, number> = {};

    for (const column of BUCKET_COLUMNS) {
      bucketCents[column.key] = 0n;
      bucketClaims[column.key] = 0;
    }

    let totalClaims = 0;
    let totalCents = 0n;

    for (const row of rows) {
      for (const column of BUCKET_COLUMNS) {
        bucketCents[column.key]! += toCents(row[column.key].balance);
        bucketClaims[column.key]! += row[column.key].claims;
      }
      totalClaims += row.totalClaims;
      totalCents += toCents(row.totalBalance);
    }

    return { bucketCents, bucketClaims, totalClaims, totalCents };
  }, [rows]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAscending((current) => !current);
    } else {
      setSortKey(key);
      setAscending(key === "insuranceName");
    }
  }

  const SortHeader = ({ label, sortAs }: { label: string; sortAs: SortKey }) => (
    <button
      type="button"
      onClick={() => toggleSort(sortAs)}
      className="inline-flex items-center gap-1 hover:text-slate-800"
    >
      {label}
      {sortKey === sortAs ? <span>{ascending ? "▲" : "▼"}</span> : null}
    </button>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">
          Insurance aging
          <span className="ml-2 text-xs font-normal text-slate-500">
            open batches
          </span>
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter insurance…"
            className="w-auto min-w-[170px]"
            aria-label="Filter by insurance name"
          />
          <Select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as CategoryFilter)
            }
            className="w-auto min-w-[140px]"
            aria-label="Filter by status category"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            className="px-3 py-2 text-xs"
            onClick={() => exportCsv(rows)}
            disabled={rows.length === 0}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-6">
          <EmptyState
            title={
              search
                ? "No insurance matches that filter"
                : "No claims in open batches"
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  <SortHeader label="Insurance" sortAs="insuranceName" />
                </th>
                {BUCKET_COLUMNS.map((column) => (
                  <th key={column.key} className="px-4 py-3 text-right">
                    <SortHeader label={column.label} sortAs={column.key} />
                  </th>
                ))}
                <th className="px-4 py-3 text-right">
                  <SortHeader label="Total Claims" sortAs="totalClaims" />
                </th>
                <th className="px-4 py-3 text-right">
                  <SortHeader label="Total Balance" sortAs="totalBalance" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.insuranceName} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.insuranceName}
                  </td>
                  {BUCKET_COLUMNS.map((column) => {
                    const cell = row[column.key];
                    return (
                      <td
                        key={column.key}
                        className={`px-4 py-3 text-right tabular-nums ${cell.claims > 0 ? column.cell : ""}`}
                      >
                        {cell.claims === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <>
                            <span className="block text-xs text-slate-500">
                              {cell.claims} claim{cell.claims === 1 ? "" : "s"}
                            </span>
                            <span className="block font-medium text-slate-900">
                              {formatUSD(cell.balance)}
                            </span>
                          </>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {row.totalClaims}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                    {formatUSD(row.totalBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <tr>
                <td className="px-4 py-3 text-slate-900">
                  Total ({rows.length} payer{rows.length === 1 ? "" : "s"})
                </td>
                {BUCKET_COLUMNS.map((column) => (
                  <td
                    key={column.key}
                    className="px-4 py-3 text-right tabular-nums"
                  >
                    <span className="block text-xs font-normal text-slate-500">
                      {totals.bucketClaims[column.key]} claims
                    </span>
                    <span className="block text-slate-900">
                      {formatUSD(
                        centsToDecimalString(totals.bucketCents[column.key]!),
                      )}
                    </span>
                  </td>
                ))}
                <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                  {totals.totalClaims}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                  {formatUSD(centsToDecimalString(totals.totalCents))}
                </td>
              </tr>
              {/*
                This table's totals are the whole book, 0–30 bucket included —
                the question here is what is outstanding. The summary cards at
                the top of the page ask a different question and answer it
                differently, so the difference is stated rather than left to be
                discovered.
              */}
              <tr>
                <td
                  colSpan={BUCKET_COLUMNS.length + 3}
                  className="px-4 pb-3 text-xs font-normal text-slate-500"
                >
                  Includes the 0–{NOT_ACTIONABLE_MAX_DAYS} day bucket
                  {totals.bucketClaims.bucket0_30
                    ? ` (${totals.bucketClaims.bucket0_30} claims, ${formatUSD(centsToDecimalString(totals.bucketCents.bucket0_30!))})`
                    : ""}
                  . The summary cards above exclude it — those claims are not
                  yet actionable.
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
