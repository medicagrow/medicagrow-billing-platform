"use client";

import { useCallback, useEffect, useState } from "react";
import { STATUS_LABELS, StatusFields } from "@/components/task/TaskFormFields";
import { TaskHistory } from "@/components/task/TaskHistory";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { NumericInput } from "@/components/ui/inputs/NumericInput";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { TaskStatus, TodoPriority } from "@/lib/generated/prisma/enums";
import { describeRecurrence } from "@/lib/task/recurrence-config";
import type { TaskDto, TaskNoteDto } from "@/lib/task-serialize";

/**
 * Inline expanded view of one task.
 *
 * Status saves immediately, with an optional note attached to the change. The
 * note log is add-only, so it reads as the task's history rather than a field
 * that can be rewritten.
 */
export function TaskEditPanel({
  task,
  onSaved,
  onClose,
}: {
  task: TaskDto;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();

  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [holdReleaseDate, setHoldReleaseDate] = useState(
    task.holdReleaseDate ? task.holdReleaseDate.slice(0, 10) : "",
  );
  const [priority, setPriority] = useState<TodoPriority>(task.priority);
  const [statusNote, setStatusNote] = useState("");
  const [actualMinutes, setActualMinutes] = useState(
    task.actualMinutes === null ? "" : String(task.actualMinutes),
  );
  const [tab, setTab] = useState<"detail" | "history">("detail");

  const [notes, setNotes] = useState<TaskNoteDto[]>(task.notes ?? []);
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    const response = await fetch(`/api/tasks/${task.id}/notes?pageSize=50`);
    if (response.ok) {
      const payload = await response.json();
      setNotes(payload.data);
    }
  }, [task.id]);

  useEffect(() => {
    if (task.notes === undefined) loadNotes();
  }, [task.notes, loadNotes]);

  async function saveStatus() {
    setError(null);

    if (status === TaskStatus.HOLD && holdReleaseDate === "") {
      setError("Putting a task on hold requires a release date.");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          priority,
          holdReleaseDate:
            status === TaskStatus.HOLD ? holdReleaseDate : null,
          note: statusNote || undefined,
          // Only meaningful on close; sending it otherwise would record time
          // against work still in flight.
          ...(status === TaskStatus.CLOSED && actualMinutes !== ""
            ? { actualMinutes: Number(actualMinutes) }
            : {}),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not save the change.");
        return;
      }

      const payload = await response.json().catch(() => null);

      toast(
        payload?.nextInstanceId
          ? "Task closed — next occurrence scheduled"
          : payload?.closedInstances
            ? `Series closed, including ${payload.closedInstances} pending occurrence${payload.closedInstances === 1 ? "" : "s"}`
            : "Task updated",
        "success",
      );
      setStatusNote("");
      await loadNotes();
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (newNote.trim() === "") return;

    setBusy(true);

    try {
      const response = await fetch(`/api/tasks/${task.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: newNote }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not add the note.");
        return;
      }

      setNewNote("");
      await loadNotes();
    } finally {
      setBusy(false);
    }
  }

  const partOfSeries = task.isRecurring || task.parentTaskId !== null;

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
      {error ? (
        <p className="mb-3">
          <FieldError>{error}</FieldError>
        </p>
      ) : null}

      {partOfSeries ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 border-b border-slate-200">
            {(
              [
                { key: "detail", label: "Detail" },
                { key: "history", label: "History" },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
                  tab === item.key
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {task.recurringConfig ? (
            <Badge variant="sky">
              ↻ {describeRecurrence(task.recurringConfig)}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {partOfSeries && tab === "history" ? (
        <TaskHistory taskId={task.id} />
      ) : (
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          {task.description ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Description
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                {task.description}
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <StatusFields
              values={{ status, holdReleaseDate }}
              onChange={(key, value) => {
                if (key === "status") setStatus(value as TaskStatus);
                if (key === "holdReleaseDate")
                  setHoldReleaseDate(value as string);
              }}
              idPrefix={`task-${task.id}-`}
            />

            <div className="space-y-1.5">
              <Label htmlFor={`task-${task.id}-priority`}>Priority</Label>
              <Select
                id={`task-${task.id}-priority`}
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as TodoPriority)
                }
              >
                {Object.values(TodoPriority).map((option) => (
                  <option key={option} value={option}>
                    {option.charAt(0) + option.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {status === TaskStatus.CLOSED ? (
            <div className="space-y-1.5">
              <Label htmlFor={`task-${task.id}-actual`}>
                Actual time taken (minutes)
              </Label>
              <NumericInput
                id={`task-${task.id}-actual`}
                maxLength={5}
                value={actualMinutes}
                onChange={setActualMinutes}
                placeholder="—"
              />
              {task.estimatedMinutes ? (
                <p className="text-xs text-slate-500">
                  Estimated {task.estimatedMinutes} minutes.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor={`task-${task.id}-status-note`}>
              Note for this change (optional)
            </Label>
            <Input
              id={`task-${task.id}-status-note`}
              value={statusNote}
              onChange={(event) => setStatusNote(event.target.value)}
              placeholder="What changed and why"
              maxLength={4000}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={saveStatus} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Close
            </Button>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Notes
          </p>

          <div className="mt-2 flex gap-2">
            <Input
              value={newNote}
              onChange={(event) => setNewNote(event.target.value)}
              placeholder="Add a note"
              maxLength={4000}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addNote();
                }
              }}
            />
            <Button
              variant="secondary"
              onClick={addNote}
              disabled={busy || newNote.trim() === ""}
            >
              Add
            </Button>
          </div>

          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {notes.length === 0 ? (
              <li className="text-sm text-slate-500">No notes yet.</li>
            ) : (
              notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-inset ring-slate-200"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">
                      {note.addedByName ?? "Unknown"}
                    </span>
                    <span>{formatDate(note.addedAt)}</span>
                    {note.statusChangedTo ? (
                      <Badge variant="neutral">
                        {STATUS_LABELS[note.statusChangedTo]}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">
                    {note.note}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
      )}
    </div>
  );
}
