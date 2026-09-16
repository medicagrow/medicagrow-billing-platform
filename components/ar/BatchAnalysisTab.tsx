"use client";

import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  ANALYSIS_DIMENSION_LABELS,
  ANALYSIS_DIMENSIONS,
  type AnalysisDimension,
  type AnalysisResult,
  type AnalysisRow,
} from "@/lib/ar/batch-insights-shared";
import { downloadCsv } from "@/lib/csv-export";
import { formatUSD } from "@/lib/format";
import { toCents } from "@/lib/money";

export interface DrillDownStep {
  dimension: AnalysisDimension;
  key: string | null;
}

type SortKey = "label" | "claims" | "balance" | "avgAgingDays";

const compare = (key: SortKey) => (a: AnalysisRow, b: AnalysisRow) => {
  switch (key) {
    case "label":
      return a.label.localeCompare(b.label);
    case "claims":
      return a.claims - b.claims;
    case "balance": {
      const difference = toCents(a.balance) - toCents(b.balance);
      return difference > 0n ? 1 : difference < 0n ? -1 : 0;
    }
    case "avgAgingDays":
      return a.avgAgingDays - b.avgAgingDays;
  }
};

/**
 * A pivot of the batch: claims by one dimension, optionally nested by another.
 *
 * It reads the claim list's own filters — everything in the filter bar above
 * applies — and always excludes 0–30 day claims. Any figure can be clicked to
 * land on the All Claims tab filtered to exactly those claims, which is what
 * turns a pivot from a report into a way in.
 */
export function BatchAnalysisTab({
  batchId,
  filterQuery,
  onDrillDown,
}: {
  batchId: string;
  /** The filter bar's params, without the tab, page or sort. */
  filterQuery: string;
  onDrillDown: (path: DrillDownStep[]) => void;
}) {
  const [primary, setPrimary] = useState<AnalysisDimension>("insurance");
  const [sub, setSub] = useState<AnalysisDimension | "none">("none");
  const [showClaims, setShowClaims] = useState(true);
  const [showBalance, setShowBalance] = useState(true);
  const [showAging, setShowAging] = useState(true);

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [ranWith, setRanWith] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("balance");
  const [ascending, setAscending] = useState(false);

  const requestQuery = useMemo(() => {
    const params = new URLSearchParams(filterQuery);
    params.set("primaryDimension", primary);
    params.set("subDimension", sub);
    params.set("showClaims", String(showClaims));
    params.set("showBalance", String(showBalance));
    params.set("showAvgAging", String(showAging));
    return params.toString();
  }, [filterQuery, primary, sub, showClaims, showBalance, showAging]);

  /**
   * The column toggles are display-only — all three measures come back in one
   * query — so changing one does not make the table stale. Anything else does.
   */
  const staleKey = useMemo(() => {
    const params = new URLSearchParams(requestQuery);
    params.delete("showClaims");
    params.delete("showBalance");
    params.delete("showAvgAging");
    return params.toString();
  }, [requestQuery]);

  async function generate() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/ar/batches/${batchId}/analysis?${requestQuery}`,
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not run the analysis.");
        return;
      }

      setResult(payload);
      setRanWith(staleKey);
    } catch {
      setError("Could not run the analysis. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const sortRows = (rows: AnalysisRow[]) => {
    const sorted = [...rows].sort(compare(sortKey));
    return ascending ? sorted : sorted.reverse();
  };

  const rows = useMemo(
    () =>
      result
        ? sortRows(result.rows).map((row) => ({
            ...row,
            children: row.children ? sortRows(row.children) : undefined,
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, sortKey, ascending],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAscending((current) => !current);
    else {
      setSortKey(key);
      setAscending(key === "label");
    }
  }

  function exportCsv() {
    if (!result) return;

    const headers = [
      result.sub
        ? `${ANALYSIS_DIMENSION_LABELS[result.primary]} / ${ANALYSIS_DIMENSION_LABELS[result.sub]}`
        : ANALYSIS_DIMENSION_LABELS[result.primary],
      ...(showClaims ? ["# Claims"] : []),
      ...(showBalance ? ["Balance"] : []),
      ...(showAging ? ["Avg Aging Days"] : []),
    ];

    const line = (label: string, row: Omit<AnalysisRow, "key" | "label">) => [
      label,
      ...(showClaims ? [row.claims] : []),
      ...(showBalance ? [row.balance] : []),
      ...(showAging ? [row.avgAgingDays] : []),
    ];

    downloadCsv(
      `batch-analysis-${result.primary}${result.sub ? `-${result.sub}` : ""}.csv`,
      headers,
      [
        ...rows.flatMap((row) => [
          line(row.label, row),
          ...(row.children ?? []).map((child) => line(`  ↳ ${child.label}`, child)),
        ]),
        line("Total", result.total),
      ],
    );
  }

  const SortHeader = ({
    label,
    sortAs,
    right,
  }: {
    label: string;
    sortAs: SortKey;
    right?: boolean;
  }) => (
    <th className={`px-4 py-3 ${right ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => toggleSort(sortAs)}
        className="inline-flex items-center gap-1 hover:text-slate-800"
      >
        {label}
        {sortKey === sortAs ? <span>{ascending ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );

  /** A clickable figure — lands on All Claims filtered to this cell. */
  const Cell = ({
    path,
    children,
    muted,
  }: {
    path: DrillDownStep[];
    children: React.ReactNode;
    muted?: boolean;
  }) => (
    <button
      type="button"
      onClick={() => onDrillDown(path)}
      title="View these claims"
      className={`tabular-nums underline-offset-4 hover:text-brand-700 hover:underline ${
        muted ? "text-slate-500" : "text-slate-900"
      }`}
    >
      {children}
    </button>
  );

  const stale = result !== null && ranWith !== staleKey;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <div className="space-y-1.5">
          <Label htmlFor="analysis-primary">Rows</Label>
          <Select
            id="analysis-primary"
            value={primary}
            onChange={(event) => {
              const next = event.target.value as AnalysisDimension;
              setPrimary(next);
              if (sub === next) setSub("none");
            }}
            className="w-auto min-w-[170px]"
          >
            {ANALYSIS_DIMENSIONS.map((dimension) => (
              <option key={dimension} value={dimension}>
                {ANALYSIS_DIMENSION_LABELS[dimension]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="analysis-sub">Sub-rows</Label>
          <Select
            id="analysis-sub"
            value={sub}
            onChange={(event) =>
              setSub(event.target.value as AnalysisDimension | "none")
            }
            className="w-auto min-w-[170px]"
          >
            <option value="none">None</option>
            {ANALYSIS_DIMENSIONS.filter((dimension) => dimension !== primary).map(
              (dimension) => (
                <option key={dimension} value={dimension}>
                  {ANALYSIS_DIMENSION_LABELS[dimension]}
                </option>
              ),
            )}
          </Select>
        </div>

        <fieldset className="space-y-1.5">
          <legend className="block text-sm font-medium text-slate-700">
            Columns
          </legend>
          <div className="flex flex-wrap gap-3 pt-1 text-sm text-slate-700">
            {(
              [
                ["# of Claims", showClaims, setShowClaims],
                ["Balance", showBalance, setShowBalance],
                ["Avg Aging Days", showAging, setShowAging],
              ] as const
            ).map(([label, checked, set]) => (
              <label key={label} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => set(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="ml-auto flex gap-2">
          <Button onClick={generate} disabled={loading}>
            {loading ? "Generating…" : "Generate"}
          </Button>
          <Button
            variant="secondary"
            onClick={exportCsv}
            disabled={!result || loading}
          >
            Export as CSV
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {stale ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          The filters or grouping changed since this was generated — press
          Generate to refresh.
        </p>
      ) : null}

      {!result ? (
        <EmptyState
          title="Choose a grouping and press Generate"
          description="Every filter above applies. Claims aged 30 days or less are always left out."
        />
      ) : result.rows.length === 0 ? (
        <EmptyState title="No claims match these filters" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <SortHeader
                  label={
                    result.sub
                      ? `${ANALYSIS_DIMENSION_LABELS[result.primary]} / ${ANALYSIS_DIMENSION_LABELS[result.sub]}`
                      : ANALYSIS_DIMENSION_LABELS[result.primary]
                  }
                  sortAs="label"
                />
                {showClaims ? <SortHeader label="# Claims" sortAs="claims" right /> : null}
                {showBalance ? <SortHeader label="Balance" sortAs="balance" right /> : null}
                {showAging ? (
                  <SortHeader label="Avg Aging" sortAs="avgAgingDays" right />
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const path: DrillDownStep[] = [
                  { dimension: result.primary, key: row.key },
                ];

                return (
                  <Fragment key={`${row.key ?? "none"}`}>
                    <tr className="bg-white">
                      <td className="px-4 py-2.5 font-medium">
                        <Cell path={path}>{row.label}</Cell>
                      </td>
                      {showClaims ? (
                        <td className="px-4 py-2.5 text-right">
                          <Cell path={path}>{row.claims.toLocaleString()}</Cell>
                        </td>
                      ) : null}
                      {showBalance ? (
                        <td className="px-4 py-2.5 text-right">
                          <Cell path={path}>{formatUSD(row.balance)}</Cell>
                        </td>
                      ) : null}
                      {showAging ? (
                        <td className="px-4 py-2.5 text-right">
                          <Cell path={path}>{row.avgAgingDays} days</Cell>
                        </td>
                      ) : null}
                    </tr>

                    {(row.children ?? []).map((child) => {
                      const childPath: DrillDownStep[] = [
                        ...path,
                        { dimension: result.sub!, key: child.key },
                      ];

                      return (
                        <tr key={`${row.key ?? "none"}-${child.key ?? "none"}`}>
                          <td className="py-2 pl-9 pr-4 text-[13px]">
                            <span className="mr-1 text-slate-300">↳</span>
                            <Cell path={childPath} muted>
                              {child.label}
                            </Cell>
                          </td>
                          {showClaims ? (
                            <td className="px-4 py-2 text-right text-[13px]">
                              <Cell path={childPath} muted>
                                {child.claims.toLocaleString()}
                              </Cell>
                            </td>
                          ) : null}
                          {showBalance ? (
                            <td className="px-4 py-2 text-right text-[13px]">
                              <Cell path={childPath} muted>
                                {formatUSD(child.balance)}
                              </Cell>
                            </td>
                          ) : null}
                          {showAging ? (
                            <td className="px-4 py-2 text-right text-[13px]">
                              <Cell path={childPath} muted>
                                {child.avgAgingDays} days
                              </Cell>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
            {/* Pinned below the sorted rows, whatever the sort. */}
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
              <tr>
                <td className="px-4 py-3">Total</td>
                {showClaims ? (
                  <td className="px-4 py-3 text-right tabular-nums">
                    {result.total.claims.toLocaleString()}
                  </td>
                ) : null}
                {showBalance ? (
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatUSD(result.total.balance)}
                  </td>
                ) : null}
                {showAging ? (
                  <td className="px-4 py-3 text-right tabular-nums">
                    {result.total.avgAgingDays} days
                  </td>
                ) : null}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
