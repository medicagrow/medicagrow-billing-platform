"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { NumericInput } from "@/components/ui/inputs/NumericInput";
import { Modal } from "@/components/ui/Modal";
import { PracticeField } from "@/components/ui/PracticeField";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import { TodoPriority } from "@/lib/generated/prisma/enums";
import { usePracticeDefault } from "@/lib/hooks/usePracticeDefault";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * Add-a-to-do modal, shared by My Day and the list view so the two cannot
 * drift apart on what a new to do may carry.
 */
export function AddTodoModal({
  open,
  onClose,
  practices,
  assignableUsers,
  currentUserId,
  defaultDate,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  currentUserId: string;
  /** My Day seeds this with the day being viewed. */
  defaultDate?: string;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { practiceId: contextPracticeId } = usePracticeDefault();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(defaultDate ?? "");
  const [estimatedMinutes, setEstimatedMinutes] = useState("30");
  const [priority, setPriority] = useState<TodoPriority>(TodoPriority.MEDIUM);
  const [practiceId, setPracticeId] = useState(contextPracticeId ?? "");
  const [assignedToId, setAssignedToId] = useState(currentUserId);
  const [isShared, setIsShared] = useState(false);

  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">(
    "weekly",
  );
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(WEEKDAYS);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [endDate, setEndDate] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setTitle("");
    setDescription("");
    setDueDate(defaultDate ?? "");
    setEstimatedMinutes("30");
    setPriority(TodoPriority.MEDIUM);
    setPracticeId(contextPracticeId ?? "");
    setAssignedToId(currentUserId);
    setIsShared(false);
    setIsRecurring(false);
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!title.trim()) return setError("Enter a title.");
    if (isRecurring && !dueDate) {
      return setError("A recurring to do needs a start date.");
    }

    setSaving(true);

    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description || undefined,
          // A locked top-bar practice wins over whatever is in state.
          practiceId: contextPracticeId ?? practiceId ?? undefined,
          assignedToId,
          dueDate: dueDate || undefined,
          estimatedMinutes: estimatedMinutes
            ? Number(estimatedMinutes)
            : undefined,
          priority,
          isShared: assignedToId === currentUserId ? false : isShared,
          isRecurring,
          recurringConfig: isRecurring
            ? {
                frequency,
                ...(frequency === "weekly" ? { daysOfWeek } : {}),
                ...(frequency === "monthly"
                  ? { dayOfMonth: Number(dayOfMonth || 1) }
                  : {}),
                ...(endDate ? { endDate } : {}),
              }
            : undefined,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not create the to do.");
        return;
      }

      toast(
        payload?.generatedInstances
          ? `Added with ${payload.generatedInstances} future occurrences`
          : "To do added",
        "success",
      );

      reset();
      onClose();
      onCreated?.();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => (saving ? undefined : onClose())}
      title="Add a to do"
      description="Personal planning — assign it out only if someone else will do it."
      wide
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="add-todo-form" disabled={saving}>
            {saving ? "Adding…" : "Add to do"}
          </Button>
        </div>
      }
    >
      <form id="add-todo-form" onSubmit={handleSubmit} className="space-y-4">
        {error ? <FieldError>{error}</FieldError> : null}

        <div className="space-y-1.5">
          <Label htmlFor="add-todo-title">Title</Label>
          <Input
            id="add-todo-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            disabled={saving}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="add-todo-description">Description</Label>
          <textarea
            id="add-todo-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={4000}
            disabled={saving}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <PracticeField
            id="add-todo-practice"
            value={practiceId}
            onChange={setPracticeId}
            practices={practices}
            disabled={saving}
            required={false}
          />

          <div className="space-y-1.5">
            <Label htmlFor="add-todo-assignee">Assigned to</Label>
            <Select
              id="add-todo-assignee"
              value={assignedToId}
              onChange={(event) => setAssignedToId(event.target.value)}
              disabled={saving || assignableUsers.length <= 1}
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
            <Label htmlFor="add-todo-due">
              {isRecurring ? "First occurrence" : "Due date"}
            </Label>
            <Input
              id="add-todo-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-todo-minutes">Estimated minutes</Label>
            <NumericInput
              id="add-todo-minutes"
              maxLength={4}
              value={estimatedMinutes}
              onChange={setEstimatedMinutes}
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-todo-priority">Priority</Label>
            <Select
              id="add-todo-priority"
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

        <div className="rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(event) => setIsRecurring(event.target.checked)}
              disabled={saving}
              className="h-4 w-4 rounded border-slate-300"
            />
            Recurring
          </label>

          {isRecurring ? (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="add-todo-frequency">Frequency</Label>
                  <Select
                    id="add-todo-frequency"
                    value={frequency}
                    onChange={(event) =>
                      setFrequency(
                        event.target.value as "daily" | "weekly" | "monthly",
                      )
                    }
                    disabled={saving}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </Select>
                </div>

                {frequency === "monthly" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="add-todo-dayofmonth">Day of month</Label>
                    <NumericInput
                      id="add-todo-dayofmonth"
                      maxLength={2}
                      value={dayOfMonth}
                      onChange={setDayOfMonth}
                      disabled={saving}
                    />
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="add-todo-enddate">End date (optional)</Label>
                  <Input
                    id="add-todo-enddate"
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>

              {frequency === "weekly" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="add-todo-days">Days</Label>
                    <button
                      type="button"
                      onClick={() => setDaysOfWeek(WEEKDAYS)}
                      disabled={saving}
                      className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
                    >
                      Weekdays
                    </button>
                  </div>
                  <div id="add-todo-days" className="flex flex-wrap gap-1">
                    {DAY_NAMES.map((name, index) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() =>
                          setDaysOfWeek((current) =>
                            current.includes(index)
                              ? current.filter((day) => day !== index)
                              : [...current, index].sort((a, b) => a - b),
                          )
                        }
                        disabled={saving}
                        aria-pressed={daysOfWeek.includes(index)}
                        className={`rounded-md px-2.5 py-1 text-xs ring-1 ring-inset ${
                          daysOfWeek.includes(index)
                            ? "bg-brand-600 text-white ring-brand-600"
                            : "bg-white text-slate-600 ring-slate-300"
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="text-xs text-slate-500">
                Occurrences are scheduled 60 days ahead, and topped up each time
                one is completed.
              </p>
            </div>
          ) : null}
        </div>

        {assignedToId !== currentUserId ? (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(event) => setIsShared(event.target.checked)}
              disabled={saving}
              className="h-4 w-4 rounded border-slate-300"
            />
            Keep visible in my list
          </label>
        ) : null}
      </form>
    </Modal>
  );
}
