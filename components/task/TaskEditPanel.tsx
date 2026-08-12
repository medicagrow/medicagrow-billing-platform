"use client";

import { useCallback, useEffect, useState } from "react";
import { STATUS_LABELS, StatusFields } from "@/components/task/TaskFormFields";
import { TaskHistory } from "@/components/task/TaskHistory";
import { TaskTimerPanel } from "@/components/task/TaskTimerPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { NumericInput } from "@/components/ui/inputs/NumericInput";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import { formatUSD } from "@/lib/format";
import { formatMinutes } from "@/lib/task-timer-serialize";
import { TaskStatus, TodoPriority } from "@/lib/generated/prisma/enums";
import {
  AUTO_SOURCE_NOTE,
  productivityConfigFor,
} from "@/lib/task/productivity-config";
import { describeRecurrence } from "@/lib/task/recurrence-config";
import type { TaskDto, TaskNoteDto } from "@/lib/task-serialize";
import { formatDateTimeIST } from "@/lib/timezone";

/** What `GET /api/tasks/[taskId]/productivity-preview` returns. */
interface ProductivityPreview {
  count: number | null;
  amount: string | null;
  source: "AR" | "EOB" | null;
  from: string | null;
  to: string | null;
  sessionCount: number;
  practiceName: string | null;
}

/**
 * Inline expanded view of one task.
 *
 * Status saves immediately, with an optional note attached to the change. The
 * note log is add-only, so it reads as the task's history rather than a field
 * that can be rewritten.
 */
export function TaskEditPanel({
  task,
  currentUserId,
  canEditEstimate = false,
  canCloseWithoutTimer = false,
  canEditTimeDirectly = false,
  onSaved,
  onClose,
}: {
  task: TaskDto;
  currentUserId: string;
  /** The estimate is the yardstick, so only PM/Owner may move it. */
  canEditEstimate?: boolean;
  /**
   * PMs and Owners close tasks they manage but did not personally work, so
   * the timer requirement does not apply to them.
   */
  canCloseWithoutTimer?: boolean;
  /** PM/Owner correct a time log outright; billers request an edit. */
  canEditTimeDirectly?: boolean;
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
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    task.estimatedMinutes === null ? "" : String(task.estimatedMinutes),
  );
  const [tab, setTab] = useState<"detail" | "history">("detail");

  const [productivityCount, setProductivityCount] = useState(
    task.productivityCount === null ? "" : String(task.productivityCount),
  );
  const [productivityAmount, setProductivityAmount] = useState(
    task.productivityAmount ?? "",
  );

  // What "how much got done" means here depends on the task's type.
  const productivity = productivityConfigFor(task.taskTypeName);

  /**
   * What the auto-linked count will be, fetched before the close rather than
   * discovered after it. Null until asked for; once shown, the save button
   * becomes a confirmation.
   */
  const [preview, setPreview] = useState<ProductivityPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const needsPreview =
    Boolean(productivity?.autoSourceModule) &&
    status === TaskStatus.CLOSED &&
    task.status !== TaskStatus.CLOSED;

  // A changed status invalidates a preview taken against the old one.
  useEffect(() => {
    if (!needsPreview) setPreview(null);
  }, [needsPreview]);

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

    // The route enforces this too; catching it here saves a round trip and
    // keeps the message next to the control that caused it.
    if (
      status === TaskStatus.CLOSED &&
      task.status !== TaskStatus.CLOSED &&
      task.totalLoggedMinutes === 0 &&
      !canCloseWithoutTimer
    ) {
      setError("You must log time with the timer before closing this task");
      return;
    }

    /**
     * For the auto-counted types the biller sees what will be recorded before
     * it is recorded. The count comes from their own timer sessions, so it is
     * a consequence of how they worked rather than something they choose —
     * being shown it first is the difference between a measurement and a
     * surprise.
     */
    if (needsPreview && preview === null) {
      setPreviewing(true);

      try {
        const response = await fetch(
          `/api/tasks/${task.id}/productivity-preview`,
        );

        if (response.ok) {
          setPreview(await response.json());
          return;
        }

        // A failed preview must not block the close; the server counts again
        // on save regardless.
        setPreview({
          count: null,
          amount: null,
          source: null,
          from: null,
          to: null,
          sessionCount: 0,
          practiceName: null,
        });
        return;
      } finally {
        setPreviewing(false);
      }
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
          ...(canEditEstimate
            ? {
                estimatedMinutes:
                  estimatedMinutes === "" ? null : Number(estimatedMinutes),
              }
            : {}),
          // Auto-sourced counts come from the module's own audit trail, so the
          // panel never posts one.
          ...(status === TaskStatus.CLOSED &&
          productivity &&
          !productivity.autoSourceModule
            ? {
                productivityCount:
                  productivityCount === "" ? null : Number(productivityCount),
                productivityAmount:
                  productivityAmount === "" ? null : productivityAmount,
              }
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

          <TaskTimerPanel
            task={task}
            currentUserId={currentUserId}
            canEditTimeDirectly={canEditTimeDirectly}
            onChanged={onSaved}
          />

          {status === TaskStatus.CLOSED && productivity ? (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Productivity
              </p>

              {productivity.autoSourceModule ? (
                <>
                  <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-inset ring-sky-200">
                    {AUTO_SOURCE_NOTE[productivity.autoSourceModule]} — no
                    manual entry needed.
                  </p>

                  {/*
                    What closing will record, shown before it is recorded. Zero
                    is amber rather than an error: working off the clock is a
                    reason to check, not something to be blocked over.
                  */}
                  {preview ? (
                    <div
                      className={`rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${
                        preview.count === 0
                          ? "bg-amber-50 text-amber-900 ring-amber-200"
                          : "bg-slate-50 text-slate-700 ring-slate-200"
                      }`}
                    >
                      {preview.count === 0 ? (
                        <p className="font-medium">
                          No{" "}
                          {preview.source === "EOB" ? "EOB" : "AR"} work was
                          found during your timer sessions
                          {preview.practiceName
                            ? ` for ${preview.practiceName}`
                            : ""}
                          . Close anyway and the productivity count will be 0.
                        </p>
                      ) : (
                        <p className="font-medium">
                          Based on your timer sessions, we found{" "}
                          {preview.count}{" "}
                          {preview.source === "EOB"
                            ? "denials worked"
                            : "claims worked"}
                          {preview.amount && preview.source === "EOB"
                            ? ` · ${formatUSD(preview.amount)} denied`
                            : ""}
                          .
                        </p>
                      )}

                      {preview.from && preview.to ? (
                        <p className="mt-1 text-slate-500">
                          Counted work logged between{" "}
                          {formatDateTimeIST(preview.from)} and{" "}
                          {formatDateTimeIST(preview.to)} (
                          {preview.sessionCount} session
                          {preview.sessionCount === 1 ? "" : "s"}).
                        </p>
                      ) : (
                        <p className="mt-1 text-slate-500">
                          No stopped timer sessions on this task.
                        </p>
                      )}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {productivity.showCount ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`task-${task.id}-prod-count`}>
                        {productivity.countLabel}
                      </Label>
                      <NumericInput
                        id={`task-${task.id}-prod-count`}
                        maxLength={6}
                        value={productivityCount}
                        onChange={setProductivityCount}
                        placeholder="—"
                      />
                    </div>
                  ) : null}

                  {productivity.showAmount ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`task-${task.id}-prod-amount`}>
                        {productivity.amountLabel}
                      </Label>
                      <DecimalInput
                        id={`task-${task.id}-prod-amount`}
                        value={productivityAmount}
                        onChange={setProductivityAmount}
                      />
                    </div>
                  ) : null}
                </div>
              )}

              <p className="text-xs text-slate-500">
                Optional — the task can be closed without these.
              </p>
            </div>
          ) : null}

          {task.status === TaskStatus.CLOSED &&
          productivity &&
          (task.productivityCount !== null ||
            task.productivityAmount !== null) ? (
            <p className="text-xs text-slate-600">
              Productivity:{" "}
              {task.productivityCount !== null ? (
                <span className="font-medium text-slate-900">
                  {task.productivityCount} {productivity.countLabel}
                </span>
              ) : null}
              {task.productivityAmount !== null ? (
                <span className="font-medium text-slate-900">
                  {task.productivityCount !== null ? " / " : ""}
                  {formatUSD(task.productivityAmount)}{" "}
                  {productivity.amountLabel}
                </span>
              ) : null}
            </p>
          ) : null}

          {/*
            Time taken is read from the timer, never typed. A remembered figure
            was being compared against the estimate as though it were measured.
          */}
          {status === TaskStatus.CLOSED ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-700">Actual time</p>
              {task.totalLoggedMinutes > 0 ? (
                <p className="text-sm text-slate-700">
                  <span className="font-medium text-slate-900">
                    {formatMinutes(task.totalLoggedMinutes)}
                  </span>{" "}
                  <span className="text-slate-500">(from timer logs)</span>
                </p>
              ) : (
                <p className="text-sm font-medium text-amber-700">
                  No time logged
                </p>
              )}
              {task.estimatedMinutes ? (
                <p className="text-xs text-slate-500">
                  Estimated {formatMinutes(task.estimatedMinutes)}.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor={`task-${task.id}-estimate`}>Estimated Time</Label>
            {canEditEstimate ? (
              <>
                <NumericInput
                  id={`task-${task.id}-estimate`}
                  maxLength={4}
                  value={estimatedMinutes}
                  onChange={setEstimatedMinutes}
                  placeholder="—"
                />
                <p className="text-xs text-slate-500">minutes</p>
              </>
            ) : (
              <p className="text-sm text-slate-700">
                Est:{" "}
                {task.estimatedMinutes === null
                  ? "not set"
                  : formatMinutes(task.estimatedMinutes)}
              </p>
            )}
          </div>

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
            <Button onClick={saveStatus} disabled={busy || previewing}>
              {busy
                ? "Saving…"
                : previewing
                  ? "Checking…"
                  : preview
                    ? "Confirm and close"
                    : "Save"}
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
                    <span>{formatDateTimeIST(note.addedAt)}</span>
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
