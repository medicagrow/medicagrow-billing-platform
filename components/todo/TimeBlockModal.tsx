"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { TimeBlockType } from "@/lib/generated/prisma/enums";

interface BlockRow {
  id: string;
  dayOfWeek: number | null;
  specificDate: string | null;
  startTime: string;
  endTime: string;
  label: string;
  blockType: TimeBlockType;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

const BLOCK_TYPE_LABELS: Record<TimeBlockType, string> = {
  FIXED: "Fixed",
  TODO_WORK: "To Do work",
  BREAK: "Break",
  MEETING: "Meeting",
};

type Tab = "weekly" | "specific";

/**
 * Schedule editor.
 *
 * The weekly tab manages the repeating template; the specific-dates tab
 * manages one-off blocks that exist on a single day. Per-date *overrides* of
 * a template block are not listed here — they belong to the day being viewed
 * and are edited inline on My Day.
 */
export function TimeBlockModal({ onSaved }: { onSaved: () => void }) {
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("weekly");
  const [weekly, setWeekly] = useState<BlockRow[]>([]);
  const [specific, setSpecific] = useState<BlockRow[]>([]);

  const [selectedDays, setSelectedDays] = useState<number[]>([1]);
  const [specificDate, setSpecificDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [label, setLabel] = useState("");
  const [blockType, setBlockType] = useState<TimeBlockType>(
    TimeBlockType.TODO_WORK,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [weeklyRes, specificRes] = await Promise.all([
      fetch("/api/time-blocks?scope=weekly"),
      fetch("/api/time-blocks?scope=specific"),
    ]);

    if (weeklyRes.ok) setWeekly((await weeklyRes.json()).data);
    if (specificRes.ok) setSpecific((await specificRes.json()).data);
  }, []);

  useEffect(() => {
    if (open) loadAll();
  }, [open, loadAll]);

  function validate() {
    if (!label.trim()) return "Give the block a label.";
    if (startTime >= endTime) return "End time must be after start.";
    if (tab === "weekly" && selectedDays.length === 0) {
      return "Choose at least one day.";
    }
    if (tab === "specific" && !specificDate) return "Choose a date.";
    return null;
  }

  async function addBlock() {
    const problem = validate();
    setError(problem);
    if (problem) return;

    setSaving(true);

    try {
      const shared = {
        startTime,
        endTime,
        label: label.trim(),
        blockType,
      };

      // The API takes one weekday per row, so a multi-day selection becomes
      // one POST per day rather than a bulk shape only this caller would use.
      const payloads =
        tab === "weekly"
          ? selectedDays.map((day) => ({ ...shared, dayOfWeek: day }))
          : [{ ...shared, specificDate }];

      const results = await Promise.all(
        payloads.map((body) =>
          fetch("/api/time-blocks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      );

      const failed = results.filter((response) => !response.ok);

      if (failed.length > 0) {
        const payload = await failed[0]!.json().catch(() => null);
        setError(payload?.error ?? "Could not add the block.");
        if (failed.length === results.length) return;
      }

      const added = results.length - failed.length;

      setLabel("");
      toast(
        added === 1 ? "Time block added" : `Time block added to ${added} days`,
      );

      await loadAll();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function removeBlock(blockId: string) {
    const response = await fetch(`/api/time-blocks/${blockId}`, {
      method: "DELETE",
    });

    if (response.ok) {
      toast("Time block removed");
      await loadAll();
      onSaved();
    }
  }

  const rows = tab === "weekly" ? weekly : specific;

  return (
    <>
      <Button
        variant="secondary"
        className="px-2.5 py-1 text-xs"
        onClick={() => setOpen(true)}
      >
        Edit Schedule
      </Button>

      <Modal
        open={open}
        onClose={() => (saving ? undefined : setOpen(false))}
        title="Schedule"
        description="TODO_WORK blocks define your daily capacity. Weekly blocks repeat; specific-date blocks happen once."
        wide
      >
        <div className="mb-4 flex gap-1 border-b border-slate-200">
          {(
            [
              { key: "weekly", label: "Weekly Template" },
              { key: "specific", label: "Specific Dates" },
            ] as { key: Tab; label: string }[]
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setTab(item.key);
                setError(null);
              }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab === item.key
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {tab === "weekly" ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="schedule-days">Days</Label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedDays(WEEKDAYS)}
                    disabled={saving}
                    className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
                  >
                    Weekdays
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDays(WEEKEND)}
                    disabled={saving}
                    className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
                  >
                    Weekend
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDays([])}
                    disabled={saving}
                    className="rounded-md px-2 py-1 text-xs text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div id="schedule-days" className="flex flex-wrap gap-1">
                {DAY_NAMES.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() =>
                      setSelectedDays((current) =>
                        current.includes(index)
                          ? current.filter((day) => day !== index)
                          : [...current, index].sort((a, b) => a - b),
                      )
                    }
                    disabled={saving}
                    aria-pressed={selectedDays.includes(index)}
                    className={`rounded-md px-2.5 py-1 text-xs ring-1 ring-inset ${
                      selectedDays.includes(index)
                        ? "bg-brand-600 text-white ring-brand-600"
                        : "bg-white text-slate-600 ring-slate-300"
                    }`}
                  >
                    {name.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="schedule-date">Date</Label>
              <Input
                id="schedule-date"
                type="date"
                value={specificDate}
                onChange={(event) => setSpecificDate(event.target.value)}
                disabled={saving}
              />
              <p className="text-xs text-slate-500">
                This block appears only on that day.
              </p>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-5">
            <Input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              disabled={saving}
              aria-label="Start time"
            />
            <Input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              disabled={saving}
              aria-label="End time"
            />
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="AR Follow-up"
              disabled={saving}
              maxLength={80}
              aria-label="Label"
              className="sm:col-span-2"
            />
            <Select
              value={blockType}
              onChange={(event) =>
                setBlockType(event.target.value as TimeBlockType)
              }
              disabled={saving}
              aria-label="Block type"
            >
              {Object.values(TimeBlockType).map((type) => (
                <option key={type} value={type}>
                  {BLOCK_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </div>

          {error ? <p className="text-xs text-red-600">{error}</p> : null}

          <Button onClick={addBlock} disabled={saving}>
            {saving ? "Adding…" : "Add block"}
          </Button>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">
                    {tab === "weekly" ? "Day" : "Date"}
                  </th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-sm text-slate-500"
                    >
                      {tab === "weekly"
                        ? "No weekly blocks yet."
                        : "No one-off blocks yet."}
                    </td>
                  </tr>
                ) : (
                  rows.map((block) => (
                    <tr key={block.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {block.dayOfWeek !== null
                          ? DAY_NAMES[block.dayOfWeek]
                          : block.specificDate
                            ? formatDate(block.specificDate)
                            : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                        {block.startTime}–{block.endTime}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {block.label}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="neutral">
                          {BLOCK_TYPE_LABELS[block.blockType]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeBlock(block.id)}
                          className="text-sm text-slate-400 hover:text-red-600"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </>
  );
}
