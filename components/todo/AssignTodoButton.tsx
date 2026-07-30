"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { NumericInput } from "@/components/ui/inputs/NumericInput";
import { PracticeField } from "@/components/ui/PracticeField";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import { TodoPriority } from "@/lib/generated/prisma/enums";
import { usePracticeDefault } from "@/lib/hooks/usePracticeDefault";

/**
 * Assigns a to do to someone else and keeps it in the assigner's own list.
 *
 * To Dos are personal planning, so one handed to another person would normally
 * vanish from the creator's view — `isShared` is what keeps it visible, and
 * this button always sets it.
 */
export function AssignTodoButton({
  practices,
  assignableUsers,
  currentUserId,
}: {
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { practiceId: contextPracticeId } = usePracticeDefault();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [practiceId, setPracticeId] = useState(contextPracticeId ?? "");
  const [assignedToId, setAssignedToId] = useState(
    assignableUsers.find((user) => user.id !== currentUserId)?.id ??
      currentUserId,
  );
  const [dueDate, setDueDate] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("30");
  const [priority, setPriority] = useState<TodoPriority>(TodoPriority.MEDIUM);
  const [keepVisible, setKeepVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);

    if (title.trim() === "") {
      setError("A title is required.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description || undefined,
          practiceId: contextPracticeId ?? practiceId ?? undefined,
          assignedToId,
          dueDate: dueDate || undefined,
          estimatedMinutes: estimatedMinutes
            ? Number(estimatedMinutes)
            : undefined,
          priority,
          isShared: keepVisible,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not create the to do.");
        return;
      }

      toast("To do assigned", "success");
      setTitle("");
      setDescription("");
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Assign to do</Button>

      <Modal
        open={open}
        onClose={() => (saving ? undefined : setOpen(false))}
        title="Assign a to do"
        description="It stays in your list as well as theirs."
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? "Assigning…" : "Assign"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error ? <FieldError>{error}</FieldError> : null}

          <div className="space-y-1.5">
            <Label htmlFor="assign-todo-title">Title</Label>
            <Input
              id="assign-todo-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assign-todo-description">Description</Label>
            <textarea
              id="assign-todo-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={4000}
              disabled={saving}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <PracticeField
              id="assign-todo-practice"
              value={practiceId}
              onChange={setPracticeId}
              practices={practices}
              disabled={saving}
              required={false}
            />

            <div className="space-y-1.5">
              <Label htmlFor="assign-todo-assignee">Assign to</Label>
              <Select
                id="assign-todo-assignee"
                value={assignedToId}
                onChange={(event) => setAssignedToId(event.target.value)}
                disabled={saving}
              >
                {assignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="assign-todo-due">Due date</Label>
              <Input
                id="assign-todo-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="assign-todo-minutes">Estimated minutes</Label>
              <NumericInput
                id="assign-todo-minutes"
                maxLength={4}
                value={estimatedMinutes}
                onChange={setEstimatedMinutes}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="assign-todo-priority">Priority</Label>
              <Select
                id="assign-todo-priority"
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as TodoPriority)
                }
                disabled={saving}
              >
                {Object.values(TodoPriority).map((option) => (
                  <option key={option} value={option}>
                    {option.charAt(0) + option.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {assignedToId !== currentUserId ? (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={keepVisible}
                onChange={(event) => setKeepVisible(event.target.checked)}
                disabled={saving}
                className="h-4 w-4 rounded border-slate-300"
              />
              Keep visible in my list
            </label>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
