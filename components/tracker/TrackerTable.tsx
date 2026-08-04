"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ScoreCell } from "@/components/tracker/ScoreCell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { downloadCsv } from "@/lib/csv-export";
import { SCORE_KEYS, SCORE_LABELS } from "@/lib/tracker/scoring";

export interface TrackerRow {
  practiceId: string;
  practiceName: string;
  entryId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  scoreC: number | null;
  scoreD: number | null;
  scoreE: number | null;
  scoreF: number | null;
  scoreG: number | null;
  scoreH: number | null;
  finalScore: number | null;
  lockStatus: string | null;
}

export function TrackerTable({
  rows,
  monthYear,
}: {
  rows: TrackerRow[];
  monthYear: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [onlyWithEntries, setOnlyWithEntries] = useState(false);

  const visible = onlyWithEntries
    ? rows.filter((row) => row.entryId !== null)
    : rows;

  function changeMonth(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("monthYear", value);
    router.push(`/tracker?${params.toString()}`);
  }

  function handleExport() {
    downloadCsv(
      `practice-health-${monthYear}.csv`,
      [
        "Practice",
        ...SCORE_KEYS.map((key) => SCORE_LABELS[key]),
        "Final Score",
        "Status",
      ],
      visible.map((row) => [
        row.practiceName,
        ...SCORE_KEYS.map((key) => row[key] ?? "N/A"),
        row.finalScore ?? "N/A",
        row.entryId ? (row.lockStatus === "LOCKED" ? "Locked" : "Draft") : "No entry",
      ]),
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <label
            htmlFor="tracker-month"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Month
          </label>
          <Input
            id="tracker-month"
            type="month"
            value={monthYear}
            onChange={(event) => changeMonth(event.target.value)}
            className="w-auto"
          />
        </div>

        <div className="flex items-end gap-2">
          <Select
            value={onlyWithEntries ? "entries" : "all"}
            onChange={(event) =>
              setOnlyWithEntries(event.target.value === "entries")
            }
            className="w-auto min-w-[170px]"
            aria-label="Filter practices"
          >
            <option value="all">All practices</option>
            <option value="entries">Only with entries</option>
          </Select>
          <Button
            variant="secondary"
            className="px-3 py-2 text-xs"
            onClick={handleExport}
            disabled={visible.length === 0}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No practices to show"
          description="Add a practice in Settings, or clear the filter."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Practice</th>
                {SCORE_KEYS.map((key) => (
                  <th
                    key={key}
                    className="px-3 py-3 text-center"
                    title={SCORE_LABELS[key]}
                  >
                    {key.replace("score", "")}
                  </th>
                ))}
                <th className="px-4 py-3 text-center">Final</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((row) => (
                <tr key={row.practiceId} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/tracker/${row.practiceId}/${monthYear}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {row.practiceName}
                    </Link>
                  </td>
                  {SCORE_KEYS.map((key) => (
                    <td key={key} className="px-3 py-3 text-center">
                      <ScoreCell score={row[key]} />
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center">
                    {/* The score is the question; the month behind it is the answer. */}
                    <Link
                      href={`/tracker/${row.practiceId}/${monthYear}`}
                      className="inline-block"
                      aria-label={`Open ${row.practiceName}'s scorecard`}
                    >
                      <ScoreCell score={row.finalScore} size="lg" />
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {!row.entryId ? (
                      <Badge variant="neutral">No entry</Badge>
                    ) : row.lockStatus === "LOCKED" ? (
                      <Badge variant="neutral">Locked</Badge>
                    ) : (
                      <Badge variant="brand">Draft</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/tracker/${row.practiceId}/${monthYear}`}
                      className="text-xs font-medium text-brand-700 hover:text-brand-800"
                    >
                      {row.entryId ? "Edit" : "Add Entry"}
                    </Link>
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
