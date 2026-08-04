"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toast";
import {
  emptyTaskForm,
  recurringConfigFrom,
  TaskFormFields,
  type TaskFormValues,
  type TaskTypeOption,
} from "@/components/task/TaskFormFields";
import type { TaskDto } from "@/lib/task-serialize";
import {
  parseRecurringConfig,
  WEEKDAYS,
  type RecurringFrequency,
} from "@/lib/task/recurrence-config";
import type { SeriesScope } from "@/lib/validations/task";

/**
 * How far a series edit reaches.
 *
 * "Future only" is the default because it is the one that cannot rewrite
 * history: a closed occurrence is the record of what somebody actually did,
 * and moving its practice or assignee afterwards would make the productivity
 * reports disagree with the work. Correcting a series that was misfiled from
 * the start is the reason the third option exists.
 */
const SCOPES: { value: SeriesScope; label: string; hint: string }[] = [
  {
    value: "future",
    label: "Update future instances only",
    hint: "Occurrences due after today. Nothing already in progress moves.",
  },
  {
    value: "this",
    label: "Update this and all future instances",
    hint: "This occurrence and every open one after it.",
  },
  {
    value: "all",
    label: "Update all instances including completed ones",
    hint: "Rewrites closed occurrences too — use for a series filed wrongly.",
  },
];

/** The form values a task already holds. */
function formFor(task: TaskDto): TaskFormValues {
  const base = emptyTaskForm(task.assignedToId);
  const config = parseRecurringConfig(task.recurringConfig);

  return {
    ...base,
    description: task.description ?? "",
    practiceId: task.practiceId ?? "",
    taskTypeId: task.taskTypeId ?? "",
    assignedToId: task.assignedToId,
    dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
    estimatedMinutes:
      task.estimatedMinutes === null ? "" : String(task.estimatedMinutes),
    priority: task.priority,
    isVisibleToCreator: task.isVisibleToCreator,
    isRecurring: config !== null,
    frequency: (config?.frequency ?? "weekly") as RecurringFrequency,
    daysOfWeek: config?.daysOfWeek ?? WEEKDAYS,
    dayOfMonth: String(config?.dayOfMonth ?? 1),
    nextDueDate:
      config?.nextDueDate ?? (task.dueDate ? task.dueDate.slice(0, 10) : ""),
    endDate: config?.endDate ?? "",
  };
}

export function TaskEditModal({
  task,
  practices,
  assignableUsers,
  taskTypes,
  onClose,
  onSaved,
}: {
  task: TaskDto;
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  taskTypes: TaskTypeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();

  const partOfSeries = task.isRecurring || task.parentTaskId !== null;

  const [values, setValues] = useState<TaskFormValues>(() => formFor(task));

  /**
   * An occurrence carries no recurrence config of its own — the parent holds
   * it — so the schedule fields are filled in from the parent. Fetched here
   * rather than threaded through every list that can open this modal.
   */
  useEffect(() => {
    if (!task.parentTaskId) return;

    let cancelled = false;

    fetch(`/api/tasks/${task.parentTaskId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const parent = parseRecurringConfig(payload?.task?.recurringConfig);
        if (cancelled || !parent) return;

        setValues((current) => ({
          ...current,
          isRecurring: true,
          frequency: parent.frequency,
          daysOfWeek: parent.daysOfWeek ?? WEEKDAYS,
          dayOfMonth: String(parent.dayOfMonth ?? 1),
          nextDueDate: parent.nextDueDate,
          endDate: parent.endDate ?? "",
        }));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [task.parentTaskId]);

  const [scope, setScope] = useState<SeriesScope>("future");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (values.taskTypeId === "") {
      setError("Please select a task type.");
      return;
    }

    setSaving(true);

    try {
      const recurring = recurringConfigFrom(values);

      // A series edit reaches other people's queues, so it goes to the route
      // that knows how to walk them; a plain task is one PATCH.
      const response = partOfSeries
        ? await fetch(`/api/tasks/${task.id}/series`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scope,
              taskTypeId: values.taskTypeId,
              practiceId: values.practiceId || null,
              assignedToId: values.assignedToId,
              description: values.description || null,
              estimatedMinutes:
                values.estimatedMinutes === ""
                  ? null
                  : Number(values.estimatedMinutes),
              priority: values.priority,
              ...(recurring ? { recurringConfig: recurring } : {}),
            }),
          })
        : await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taskTypeId: values.taskTypeId,
              practiceId: values.practiceId || null,
              assignedToId: values.assignedToId,
              description: values.description || null,
              dueDate: values.dueDate || null,
              estimatedMinutes:
                values.estimatedMinutes === ""
                  ? null
                  : Number(values.estimatedMinutes),
              priority: values.priority,
              isVisibleToCreator: values.isVisibleToCreator,
              // Turning recurrence on converts the task into a template; the
              // first occurrence is generated by the schedule sweep.
              isRecurring: values.isRecurring,
              recurringConfig: recurring ?? null,
            }),
          });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          payload?.error ??
            Object.values(payload?.details?.fieldErrors ?? {})
              .flat()
              .join(" ") ??
            "Could not save the task.",
        );
        return;
      }

      toast(
        partOfSeries
          ? `Series updated${
              payload?.updatedInstances
                ? ` — ${payload.updatedInstances} occurrence${payload.updatedInstances === 1 ? "" : "s"}`
                : ""
            }`
          : "Task updated",
        "success",
      );

      onSaved();
      onClose();
    } catch {
      setError("Could not save the task. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={partOfSeries ? "Edit Recurring Task Series" : "Edit Task"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <TaskFormFields
          values={values}
          onChange={set}
          practices={practices}
          assignableUsers={assignableUsers}
          taskTypes={taskTypes}
          disabled={saving}
          showVisibility={!partOfSeries}
          // A series always recurs; the toggle only makes sense on a plain
          // task, where it is how one becomes a series.
          showRecurrence
          idPrefix={`edit-${task.id}-`}
        />

        {partOfSeries ? (
          <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium text-slate-700">
              Apply to
            </legend>
            {SCOPES.map((option) => (
              <label
                key={option.value}
                className="flex items-start gap-2 text-sm text-slate-700"
              >
                <input
                  type="radio"
                  name={`scope-${task.id}`}
                  value={option.value}
                  checked={scope === option.value}
                  onChange={() => setScope(option.value)}
                  disabled={saving}
                  className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-600"
                />
                <span>
                  {option.label}
                  <span className="block text-xs text-slate-500">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Deleting work, with the series question asked up front.
 *
 * Hard delete: these rows are removed because they should not exist, and a
 * tombstone would have to be filtered out of every list and every report
 * forever. The wording says so rather than implying it can be undone.
 */
export function TaskDeleteModal({
  task,
  onClose,
  onDeleted,
}: {
  task: TaskDto;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();

  const partOfSeries = task.isRecurring || task.parentTaskId !== null;

  const [scope, setScope] = useState<SeriesScope>("this");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: { value: SeriesScope; label: string }[] = [
    { value: "this", label: "Delete this instance only" },
    { value: "future", label: "Delete this and all future instances" },
    {
      value: "all",
      label: "Delete entire series (including completed instances)",
    },
  ];

  async function handleDelete() {
    setError(null);
    setBusy(true);

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: partOfSeries ? scope : "this" }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not delete the task.");
        return;
      }

      toast(
        payload?.deleted > 1
          ? `${payload.deleted} tasks deleted`
          : "Task deleted",
        "success",
      );

      onDeleted();
      onClose();
    } catch {
      setError("Could not delete the task. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Delete Task">
      <div className="space-y-4">
        {partOfSeries ? (
          <>
            <p className="text-sm text-slate-600">
              This task is part of a recurring series. Choose how much of it to
              remove — this cannot be undone.
            </p>
            <fieldset className="space-y-2">
              {options.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="radio"
                    name={`delete-scope-${task.id}`}
                    value={option.value}
                    checked={scope === option.value}
                    onChange={() => setScope(option.value)}
                    disabled={busy}
                    className="h-4 w-4 border-slate-300 text-red-600 focus:ring-red-600"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Delete this task? This cannot be undone — its notes and logged time
            go with it.
          </p>
        )}

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            disabled={busy}
            className="bg-red-600 hover:bg-red-700 focus-visible:outline-red-600"
          >
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
