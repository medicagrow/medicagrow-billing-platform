"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { EmptyState } from "@/components/ui/Card";
import { FieldError, Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/toast";
import type { TaskTypeOption } from "@/components/task/TaskFormFields";

interface RequirementRow {
  id: string;
  taskTypeId: string;
  monthlyHours: string;
  notes: string | null;
}

/** One editable line: a task type and what it needs each month. */
interface Draft {
  monthlyHours: string;
  notes: string;
  /** The saved values, so an unchanged row is not written again. */
  savedHours: string;
  savedNotes: string;
  requirementId: string | null;
}

/**
 * What a practice needs each month, by task type.
 *
 * This is a commitment rather than a measurement — the resource report
 * measures assigned work against it, so it has to be a number somebody chose.
 * Blank means nobody has decided yet; **zero means decided, and not needed**,
 * and the report treats the two differently.
 */
export function PracticeRequirementsTab({
  practiceId,
  taskTypes,
  canEdit,
}: {
  practiceId: string;
  taskTypes: TaskTypeOption[];
  canEdit: boolean;
}) {
  const { toast } = useToast();

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(
        `/api/settings/practices/${practiceId}/requirements`,
      );

      if (!response.ok) {
        setError("Could not load the monthly requirements.");
        return;
      }

      const payload = await response.json();
      const rows: RequirementRow[] = payload.data;

      const next: Record<string, Draft> = {};

      for (const type of taskTypes) {
        const existing = rows.find((row) => row.taskTypeId === type.id);

        next[type.id] = {
          monthlyHours: existing?.monthlyHours ?? "",
          notes: existing?.notes ?? "",
          savedHours: existing?.monthlyHours ?? "",
          savedNotes: existing?.notes ?? "",
          requirementId: existing?.id ?? null,
        };
      }

      setDrafts(next);
    } catch {
      setError("Could not load the monthly requirements.");
    } finally {
      setLoading(false);
    }
  }, [practiceId, taskTypes]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (taskTypeId: string, patch: Partial<Draft>) =>
    setDrafts((current) => ({
      ...current,
      [taskTypeId]: { ...current[taskTypeId]!, ...patch },
    }));

  async function save(taskTypeId: string) {
    const draft = drafts[taskTypeId];
    if (!draft) return;

    setError(null);

    /**
     * Clearing the hours removes the requirement rather than storing an empty
     * one — "no longer committing to a number" is a real state, and it is not
     * the same as committing to zero.
     */
    if (draft.monthlyHours.trim() === "") {
      if (!draft.requirementId) return;

      setSavingId(taskTypeId);

      try {
        const response = await fetch(
          `/api/settings/practices/${practiceId}/requirements/${draft.requirementId}`,
          { method: "DELETE" },
        );

        if (!response.ok) {
          setError("Could not remove that requirement.");
          return;
        }

        toast("Requirement removed");
        await load();
      } finally {
        setSavingId(null);
      }

      return;
    }

    setSavingId(taskTypeId);

    try {
      const response = await fetch(
        `/api/settings/practices/${practiceId}/requirements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskTypeId,
            monthlyHours: draft.monthlyHours.trim(),
            notes: draft.notes.trim() || null,
          }),
        },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          payload?.error ??
            Object.values(payload?.details?.fieldErrors ?? {})
              .flat()
              .join(" ") ??
            "Could not save that requirement.",
        );
        return;
      }

      toast("Requirement saved");
      await load();
    } catch {
      setError("Could not save. Check your connection.");
    } finally {
      setSavingId(null);
    }
  }

  const dirty = (taskTypeId: string) => {
    const draft = drafts[taskTypeId];
    if (!draft) return false;

    // Compared as numbers: DecimalInput normalises "12" to "12.00" on blur,
    // and that is the same requirement, not an edit.
    const hoursChanged =
      draft.monthlyHours.trim() === "" || draft.savedHours === ""
        ? draft.monthlyHours.trim() !== draft.savedHours
        : Number(draft.monthlyHours) !== Number(draft.savedHours);

    return hoursChanged || draft.notes !== draft.savedNotes;
  };

  const totalHours = Object.values(drafts).reduce(
    (running, draft) => running + (Number(draft.savedHours) || 0),
    0,
  );

  const setCount = Object.values(drafts).filter(
    (draft) => draft.savedHours !== "",
  ).length;

  if (taskTypes.length === 0) {
    return (
      <EmptyState
        title="No task types yet"
        description="Add task types under Settings → Task Types before setting monthly requirements."
      />
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">
          Monthly requirements
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Hours of each kind of work this practice needs per month. The resource
          report measures assigned work against these. Leave blank where no
          figure has been agreed; enter 0 to record that none is required.
        </p>
      </div>

      {error ? (
        <p className="px-4 pt-3">
          <FieldError>{error}</FieldError>
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Task type</th>
              <th className="px-4 py-3 w-40">Monthly hours</th>
              <th className="px-4 py-3">Notes</th>
              {canEdit ? <th className="px-4 py-3 w-24" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {taskTypes.map((type) => {
              const draft = drafts[type.id];

              return (
                <tr key={type.id} className="align-top">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {type.name}
                  </td>
                  <td className="px-4 py-3">
                    <DecimalInput
                      value={draft?.monthlyHours ?? ""}
                      onChange={(value) => set(type.id, { monthlyHours: value })}
                      onBlur={() => {
                        if (canEdit && dirty(type.id)) save(type.id);
                      }}
                      prefix={null}
                      placeholder="—"
                      disabled={!canEdit || loading || savingId === type.id}
                      aria-label={`${type.name} monthly hours`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      value={draft?.notes ?? ""}
                      onChange={(event) =>
                        set(type.id, { notes: event.target.value })
                      }
                      onBlur={() => {
                        if (canEdit && dirty(type.id)) save(type.id);
                      }}
                      placeholder="e.g. based on ~400 charges/month"
                      disabled={!canEdit || loading || savingId === type.id}
                      aria-label={`${type.name} notes`}
                    />
                  </td>
                  {canEdit ? (
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => save(type.id)}
                        disabled={!dirty(type.id) || savingId === type.id}
                      >
                        {savingId === type.id ? "Saving…" : "Save"}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
        Total required:{" "}
        <span className="font-semibold tabular-nums text-slate-900">
          {totalHours % 1 === 0 ? totalHours : totalHours.toFixed(2)}h
        </span>{" "}
        per month across {setCount} task type{setCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}
