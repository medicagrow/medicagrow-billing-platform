"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import {
  ANALYTICS_PERIODS,
  PICKS_ITS_OWN_DATES,
  resolvePeriod,
  toDateParam,
  type AnalyticsPeriod,
} from "@/lib/analytics/periods";

export interface AnalyticsOption {
  id: string;
  name: string;
}

/**
 * The filter bar every analytics page shares.
 *
 * Each page shows a different subset — the workload planner has no task-type
 * filter, the resource report works in months — but the controls they do share
 * behave identically, so moving between pages does not mean relearning them.
 *
 * The state itself lives in the URL, held by the page through
 * `useFilterState`. This component only renders it and reports changes, so
 * there is one place a filter can be read from and one place it is written.
 */
export interface AnalyticsFilterValue {
  period: string;
  from: string;
  to: string;
  billerIds: string[];
  practiceIds: string[];
  taskTypeIds: string[];
}

export function AnalyticsFilters({
  value,
  onChange,
  onClear,
  billers,
  practices,
  taskTypes,
  show = {},
  children,
}: {
  value: AnalyticsFilterValue;
  onChange: (updates: Partial<AnalyticsFilterValue>) => void;
  onClear: () => void;
  billers: AnalyticsOption[];
  practices: AnalyticsOption[];
  taskTypes: AnalyticsOption[];
  /** Which controls this page wants. Everything but dates defaults on. */
  show?: {
    period?: boolean;
    biller?: boolean;
    practice?: boolean;
    taskType?: boolean;
  };
  /** Page-specific controls — a group-by picker, a target-hours choice. */
  children?: React.ReactNode;
}) {
  const {
    period = true,
    biller = true,
    practice = true,
    taskType = true,
  } = show;

  const current = value.period as AnalyticsPeriod;
  const picksOwnDates = PICKS_ITS_OWN_DATES.includes(current);

  function choosePeriod(next: AnalyticsPeriod) {
    if (PICKS_ITS_OWN_DATES.includes(next)) {
      // The dates already on screen stay; the person is about to change them.
      onChange({ period: next });
      return;
    }

    /**
     * A named period resolves to real dates immediately and the URL carries
     * those, so a link sent on Friday still opens on Monday showing the week
     * it meant rather than the week of whoever opens it.
     */
    const range = resolvePeriod(next);

    onChange({
      period: next,
      from: toDateParam(range.from),
      to: toDateParam(range.to),
    });
  }

  const active =
    value.billerIds.length > 0 ||
    value.practiceIds.length > 0 ||
    value.taskTypeIds.length > 0 ||
    current !== "this_month";

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      {period ? (
        <div>
          <label
            htmlFor="analytics-period"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Period
          </label>
          <Select
            id="analytics-period"
            value={value.period}
            onChange={(event) =>
              choosePeriod(event.target.value as AnalyticsPeriod)
            }
            className="w-auto min-w-[150px]"
          >
            {ANALYTICS_PERIODS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {picksOwnDates ? (
        <>
          <div>
            <label
              htmlFor="analytics-from"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              {current === "specific" ? "Date" : "From"}
            </label>
            <Input
              id="analytics-from"
              type="date"
              value={value.from}
              max={current === "custom" ? value.to : undefined}
              onChange={(event) =>
                onChange(
                  // A single date is a range of one day, so both ends move.
                  current === "specific"
                    ? { from: event.target.value, to: event.target.value }
                    : { from: event.target.value },
                )
              }
              className="w-auto"
            />
          </div>

          {current === "custom" ? (
            <div>
              <label
                htmlFor="analytics-to"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                To
              </label>
              <Input
                id="analytics-to"
                type="date"
                value={value.to}
                min={value.from}
                onChange={(event) => onChange({ to: event.target.value })}
                className="w-auto"
              />
            </div>
          ) : null}
        </>
      ) : period ? (
        <p className="pb-2 text-xs text-slate-500">
          {value.from} → {value.to}
        </p>
      ) : null}

      {biller ? (
        <div className="min-w-[170px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Biller
          </label>
          <MultiSelectDropdown
            options={billers.map((entry) => ({
              value: entry.id,
              label: entry.name,
            }))}
            selected={value.billerIds}
            onChange={(next) => onChange({ billerIds: next })}
            placeholder="All billers"
            allLabel="All billers"
            noun="billers"
            aria-label="Filter by biller"
          />
        </div>
      ) : null}

      {practice ? (
        <div className="min-w-[170px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Practice
          </label>
          <MultiSelectDropdown
            options={practices.map((entry) => ({
              value: entry.id,
              label: entry.name,
            }))}
            selected={value.practiceIds}
            onChange={(next) => onChange({ practiceIds: next })}
            placeholder="All practices"
            allLabel="All practices"
            noun="practices"
            aria-label="Filter by practice"
          />
        </div>
      ) : null}

      {taskType ? (
        <div className="min-w-[170px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Task type
          </label>
          <MultiSelectDropdown
            options={taskTypes.map((entry) => ({
              value: entry.id,
              label: entry.name,
            }))}
            selected={value.taskTypeIds}
            onChange={(next) => onChange({ taskTypeIds: next })}
            placeholder="All task types"
            allLabel="All task types"
            noun="types"
            aria-label="Filter by task type"
          />
        </div>
      ) : null}

      {children}

      {active ? (
        <Button
          variant="secondary"
          className="px-3 py-2 text-xs"
          onClick={onClear}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
