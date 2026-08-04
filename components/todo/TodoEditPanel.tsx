"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { NumericInput } from "@/components/ui/inputs/NumericInput";
import { PracticeField } from "@/components/ui/PracticeField";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import { TodoPriority, TodoStatus } from "@/lib/generated/prisma/enums";
import { TODO_STATUS_LABELS, type TodoDto } from "@/lib/todo-serialize";
import { formatDateTimeIST } from "@/lib/timezone";

interface NoteRow {
  id: string;
  note: string;
  addedByName: string | null;
  addedAt: string;
}

/**
 * Full inline editor for one to do, shared by My Day and the list view.
 *
 * Everything saves in a single PATCH so a half-applied edit is not possible;
 * the note log below is add-only and refreshes on its own.
 */
export function TodoEditPanel({
  todo,
  practices,
  assignableUsers,
  canSubAssign,
  currentUserId,
  onSaved,
  onClose,
}: {
  todo: TodoDto;
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  /** Sub-assignment is an Owner/PM tool for delegating their own planning. */
  canSubAssign: boolean;
  currentUserId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();

  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? "");
  const [practiceId, setPracticeId] = useState(todo.practiceId ?? "");
  const [assignedToId, setAssignedToId] = useState(todo.assignedToId);
  const [subAssignedToId, setSubAssignedToId] = useState(
    todo.subAssignedToId ?? "",
  );
  const [dueDate, setDueDate] = useState(todo.dueDate?.slice(0, 10) ?? "");
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    todo.estimatedMinutes === null ? "" : String(todo.estimatedMinutes),
  );
  const [priority, setPriority] = useState<TodoPriority>(todo.priority);
  const [status, setStatus] = useState<TodoStatus>(todo.status);
  const [holdReleaseDate, setHoldReleaseDate] = useState(
    todo.holdReleaseDate?.slice(0, 10) ?? "",
  );
  const [isShared, setIsShared] = useState(todo.isShared);
  const [statusNote, setStatusNote] = useState("");

  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    const response = await fetch(`/api/todos/${todo.id}/notes?pageSize=50`);
    if (response.ok) {
      const payload = await response.json();
      setNotes(payload.data);
    }
  }, [todo.id]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  /**
   * Sub-assignment stays inside the practice when the todo has one — handing
   * work to someone with no access to the practice would be a dead end.
   */
  const subAssignCandidates = assignableUsers.filter(
    (user) => user.id !== assignedToId,
  );

  async function save() {
    setError(null);

    if (title.trim() === "") {
      setError("A title is required.");
      return;
    }

    if (status === TodoStatus.HOLD && holdReleaseDate === "") {
      setError("Putting a to do on hold requires a release date.");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description || null,
          practiceId: practiceId || null,
          assignedToId,
          subAssignedToId: subAssignedToId || null,
          dueDate: dueDate || null,
          estimatedMinutes: estimatedMinutes === "" ? null : Number(estimatedMinutes),
          priority,
          status,
          holdReleaseDate: status === TodoStatus.HOLD ? holdReleaseDate : null,
          isShared,
          note: statusNote || undefined,
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
          ? "Saved — next occurrence scheduled"
          : "To do updated",
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
      const response = await fetch(`/api/todos/${todo.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: newNote.trim() }),
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

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
      {error ? (
        <p className="mb-3">
          <FieldError>{error}</FieldError>
        </p>
      ) : null}

      {/* Both sides of a delegation see who the other is. */}
      {todo.subAssignedToId ? (
        <p className="mb-3">
          <Badge variant="amber">
            {todo.subAssignedToId === currentUserId
              ? `Sub-assigned from ${todo.assignedToName ?? "someone"}`
              : `Sub-assigned to ${todo.subAssignedToName ?? "someone"}`}
          </Badge>
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`todo-${todo.id}-title`}>Title</Label>
            <Input
              id={`todo-${todo.id}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`todo-${todo.id}-description`}>Description</Label>
            <textarea
              id={`todo-${todo.id}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={4000}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <PracticeField
              id={`todo-${todo.id}-practice`}
              value={practiceId}
              onChange={setPracticeId}
              practices={practices}
              required={false}
            />

            <div className="space-y-1.5">
              <Label htmlFor={`todo-${todo.id}-assignee`}>Assigned to</Label>
              <Select
                id={`todo-${todo.id}-assignee`}
                value={assignedToId}
                onChange={(event) => setAssignedToId(event.target.value)}
                disabled={assignableUsers.length <= 1}
              >
                {assignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {canSubAssign ? (
            <div className="space-y-1.5">
              <Label htmlFor={`todo-${todo.id}-subassign`}>Sub-assign to</Label>
              <Select
                id={`todo-${todo.id}-subassign`}
                value={subAssignedToId}
                onChange={(event) => setSubAssignedToId(event.target.value)}
              >
                <option value="">Nobody</option>
                {subAssignCandidates.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-slate-500">
                It stays in the assignee&rsquo;s list as well as theirs.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`todo-${todo.id}-due`}>Due date</Label>
              <Input
                id={`todo-${todo.id}-due`}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`todo-${todo.id}-minutes`}>Est. minutes</Label>
              <NumericInput
                id={`todo-${todo.id}-minutes`}
                maxLength={4}
                value={estimatedMinutes}
                onChange={setEstimatedMinutes}
                placeholder="—"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`todo-${todo.id}-priority`}>Priority</Label>
              <Select
                id={`todo-${todo.id}-priority`}
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`todo-${todo.id}-status`}>Status</Label>
              <Select
                id={`todo-${todo.id}-status`}
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as TodoStatus)
                }
              >
                {Object.values(TodoStatus).map((option) => (
                  <option key={option} value={option}>
                    {TODO_STATUS_LABELS[option]}
                  </option>
                ))}
              </Select>
            </div>

            {/* A held to do must say when it comes back, or it disappears. */}
            {status === TodoStatus.HOLD ? (
              <div className="space-y-1.5">
                <Label htmlFor={`todo-${todo.id}-hold`}>
                  Release from hold on
                </Label>
                <Input
                  id={`todo-${todo.id}-hold`}
                  type="date"
                  value={holdReleaseDate}
                  onChange={(event) => setHoldReleaseDate(event.target.value)}
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`todo-${todo.id}-note`}>
              Note for this change (optional)
            </Label>
            <Input
              id={`todo-${todo.id}-note`}
              value={statusNote}
              onChange={(event) => setStatusNote(event.target.value)}
              placeholder="What changed and why"
              maxLength={4000}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(event) => setIsShared(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Keep visible in my list after assigning it out
          </label>

          {todo.isRecurring ? (
            <p className="text-xs text-slate-500">
              ↻ Recurring — completing an occurrence schedules the next.
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
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

          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
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
    </div>
  );
}
