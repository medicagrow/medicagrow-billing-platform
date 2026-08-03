"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import {
  DATE_RANGE_PRESETS,
  toDateParam,
  type DateRangePreset,
} from "@/lib/productivity/date-ranges";

/**
 * Period, biller and practice, all held in the URL.
 *
 * The page stays a server component and every view of this report is a link
 * someone can send to the person it is about.
 */
export function ProductivityFilterBar({
  preset,
  from,
  to,
  billers,
  practices,
  selectedBillerIds,
  selectedPracticeIds,
}: {
  preset: DateRangePreset;
  from: string;
  to: string;
  billers: { id: string; name: string }[];
  practices: { id: string; name: string }[];
  selectedBillerIds: string[];
  selectedPracticeIds: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  function push(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }

    // A new window or filter invalidates the current page of results.
    params.delete("page");

    router.push(`${pathname}?${params.toString()}`);
  }

  function handlePreset(value: DateRangePreset) {
    if (value === "custom") {
      push({ preset: "custom", from: customFrom, to: customTo });
      return;
    }

    // Drop explicit dates so the server resolves the preset itself.
    push({ preset: value, from: null, to: null });
  }

  const filtersActive =
    selectedBillerIds.length > 0 ||
    selectedPracticeIds.length > 0 ||
    searchParams.has("preset") ||
    searchParams.has("from");

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div>
        <label
          htmlFor="range-preset"
          className="mb-1 block text-xs font-medium text-slate-600"
        >
          Period
        </label>
        <Select
          id="range-preset"
          value={preset}
          onChange={(event) =>
            handlePreset(event.target.value as DateRangePreset)
          }
          className="w-auto min-w-[150px]"
        >
          {DATE_RANGE_PRESETS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </Select>
      </div>

      {preset === "custom" ? (
        <>
          <div>
            <label
              htmlFor="range-from"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              From
            </label>
            <Input
              id="range-from"
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="w-auto"
            />
          </div>
          <div>
            <label
              htmlFor="range-to"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              To
            </label>
            <Input
              id="range-to"
              type="date"
              value={customTo}
              min={customFrom}
              max={toDateParam(new Date())}
              onChange={(event) => setCustomTo(event.target.value)}
              className="w-auto"
            />
          </div>
          <Button
            variant="secondary"
            className="px-3 py-2 text-xs"
            onClick={() =>
              push({ preset: "custom", from: customFrom, to: customTo })
            }
            disabled={!customFrom || !customTo || customFrom > customTo}
          >
            Apply
          </Button>
        </>
      ) : (
        <p className="pb-2 text-xs text-slate-500">
          {from} → {to}
        </p>
      )}

      <div className="min-w-[180px]">
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Biller
        </label>
        <MultiSelectDropdown
          options={billers.map((biller) => ({
            value: biller.id,
            label: biller.name,
          }))}
          selected={selectedBillerIds}
          onChange={(next) => push({ userIds: next.join(",") })}
          placeholder="All Billers"
          allLabel="All Billers"
          noun="billers"
          aria-label="Filter by biller"
        />
      </div>

      <div className="min-w-[180px]">
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Practice
        </label>
        <MultiSelectDropdown
          options={practices.map((practice) => ({
            value: practice.id,
            label: practice.name,
          }))}
          selected={selectedPracticeIds}
          onChange={(next) => push({ practiceIds: next.join(",") })}
          placeholder="All Practices"
          allLabel="All Practices"
          noun="practices"
          aria-label="Filter by practice"
        />
      </div>

      {filtersActive ? (
        <Button
          variant="secondary"
          className="px-3 py-2 text-xs"
          onClick={() =>
            push({
              userIds: null,
              practiceIds: null,
              preset: null,
              from: null,
              to: null,
            })
          }
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
