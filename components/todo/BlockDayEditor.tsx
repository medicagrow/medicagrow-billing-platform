"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TimeBlockType } from "@/lib/generated/prisma/enums";

export interface EditableBlock {
  id: string;
  startTime: string;
  endTime: string;
  label: string;
  blockType: TimeBlockType;
}

const BLOCK_TYPE_LABELS: Record<TimeBlockType, string> = {
  FIXED: "Fixed",
  TODO_WORK: "To Do work",
  BREAK: "Break",
  MEETING: "Meeting",
};

/**
 * Inline editor for one block on one day.
 *
 * The change lands as a per-date override, so adjusting today never rewrites
 * the weekly template. The caller decides which write that means.
 */
export function BlockDayEditor({
  block,
  onSave,
  onCancel,
}: {
  block: EditableBlock;
  onSave: (patch: {
    startTime: string;
    endTime: string;
    label: string;
    blockType: TimeBlockType;
  }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [startTime, setStartTime] = useState(block.startTime);
  const [endTime, setEndTime] = useState(block.endTime);
  const [label, setLabel] = useState(block.label);
  const [blockType, setBlockType] = useState<TimeBlockType>(block.blockType);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);

    if (!label.trim()) return setError("Give the block a label.");
    if (startTime >= endTime) return setError("End time must be after start.");

    setSaving(true);

    try {
      await onSave({
        startTime,
        endTime,
        label: label.trim(),
        blockType,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
      <div className="grid gap-1.5 sm:grid-cols-2">
        <Input
          type="time"
          value={startTime}
          onChange={(event) => setStartTime(event.target.value)}
          disabled={saving}
          className="text-xs"
          aria-label="Start time"
        />
        <Input
          type="time"
          value={endTime}
          onChange={(event) => setEndTime(event.target.value)}
          disabled={saving}
          className="text-xs"
          aria-label="End time"
        />
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          disabled={saving}
          maxLength={80}
          className="text-xs"
          aria-label="Label"
        />
        <Select
          value={blockType}
          onChange={(event) =>
            setBlockType(event.target.value as TimeBlockType)
          }
          disabled={saving}
          className="text-xs"
          aria-label="Block type"
        >
          {Object.values(TimeBlockType).map((type) => (
            <option key={type} value={type}>
              {BLOCK_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </div>

      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}

      <div className="mt-2 flex items-center gap-2">
        <Button
          className="px-2.5 py-1 text-xs"
          onClick={submit}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save for this day"}
        </Button>
        <Button
          variant="secondary"
          className="px-2.5 py-1 text-xs"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
