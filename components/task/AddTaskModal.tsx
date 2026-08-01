"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  emptyTaskForm,
  recurringConfigFrom,
  TaskFormFields,
  type TaskFormValues,
  type TaskTypeOption,
} from "@/components/task/TaskFormFields";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toast";
import { usePracticeDefault } from "@/lib/hooks/usePracticeDefault";

export function AddTaskModal({
  open,
  onClose,
  practices,
  assignableUsers,
  taskTypes,
  currentUserId,
  defaultAssignedToId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  taskTypes: TaskTypeOption[];
  currentUserId: string;
  defaultAssignedToId?: string;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();

  // The top-bar practice seeds the form; "All Practices" leaves it blank.
  const { practiceId: contextPracticeId } = usePracticeDefault();

  const [values, setValues] = useState<TaskFormValues>({
    ...emptyTaskForm(defaultAssignedToId ?? currentUserId),
    practiceId: contextPracticeId ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = <K extends keyof TaskFormValues>(
    key: K,
    value: TaskFormValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));

  function reset() {
    setValues({
      ...emptyTaskForm(defaultAssignedToId ?? currentUserId),
      practiceId: contextPracticeId ?? "",
    });
    setError(null);
  }

  async function submit() {
    setError(null);

    if (values.taskTypeId === "") {
      setError("Please select a task type.");
      return;
    }

    const recurringConfig = recurringConfigFrom(values);

    if (values.isRecurring && !recurringConfig) {
      setError("A recurring task needs a first occurrence date.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: values.description || null,
          // A locked top-bar practice wins over whatever is in state.
          practiceId: contextPracticeId ?? values.practiceId ?? null,
          taskTypeId: values.taskTypeId || null,
          assignedToId: values.assignedToId,
          dueDate: values.dueDate || undefined,
          estimatedMinutes: values.estimatedMinutes || undefined,
          priority: values.priority,
          status: values.status,
          holdReleaseDate: values.holdReleaseDate || undefined,
          isVisibleToCreator: values.isVisibleToCreator,
          isRecurring: values.isRecurring,
          recurringConfig,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not create the task.");
        return;
      }

      const created = await response.json().catch(() => null);

      toast(
        created?.generatedInstances
          ? `Task created with ${created.generatedInstances} occurrences`
          : "Task created",
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
      onClose={onClose}
      title="Add task"
      description="Assign work and track it through to completion."
      wide
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create task"}
          </Button>
        </div>
      }
    >
      {error ? (
        <p className="mb-3">
          <FieldError>{error}</FieldError>
        </p>
      ) : null}

      <TaskFormFields
        values={values}
        onChange={change}
        practices={practices}
        assignableUsers={assignableUsers}
        taskTypes={taskTypes}
        showVisibility={values.assignedToId !== currentUserId}
        idPrefix="add-task-"
      />
    </Modal>
  );
}
