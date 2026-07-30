"use client";

import { useState } from "react";
import { AddTaskModal } from "@/components/task/AddTaskModal";
import type { TaskTypeOption } from "@/components/task/TaskFormFields";
import { Button } from "@/components/ui/Button";

/** Server pages cannot hold modal state, so the trigger lives here. */
export function AssignTaskButton({
  practices,
  assignableUsers,
  taskTypes,
  currentUserId,
  label = "Assign task",
}: {
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  taskTypes: TaskTypeOption[];
  currentUserId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      <AddTaskModal
        open={open}
        onClose={() => setOpen(false)}
        practices={practices}
        assignableUsers={assignableUsers}
        taskTypes={taskTypes}
        currentUserId={currentUserId}
      />
    </>
  );
}
