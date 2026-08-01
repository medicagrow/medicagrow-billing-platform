"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AddTaskModal } from "@/components/task/AddTaskModal";
import { TaskEditPanel } from "@/components/task/TaskEditPanel";
import {
  PRIORITY_VARIANT,
  RecurringBadge,
  STATUS_LABELS,
  STATUS_VARIANT,
  TaskTypeTag,
  type TaskTypeOption,
} from "@/components/task/TaskFormFields";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/format";
import { formatMinutes } from "@/lib/task-timer-serialize";
import { TaskStatus, TodoPriority } from "@/lib/generated/prisma/enums";
import type { TaskDto } from "@/lib/task-serialize";

function Summary({ label, count, tone }: {
  label: string;
  count: number;
  tone: "sky" | "brand" | "amber" | "red";
}) {
  const toneClass = {
    sky: "text-sky-700",
    brand: "text-brand-700",
    amber: "text-amber-700",
    red: "text-red-700",
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {count}
      </p>
    </div>
  );
}

export function MyTasksClient({
  practices,
  assignableUsers,
  taskTypes,
  currentUserId,
}: {
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  taskTypes: TaskTypeOption[];
  currentUserId: string;
}) {
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [practiceFilter, setPracticeFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);

    try {
      // my-tasks also releases anything whose hold expired.
      const response = await fetch("/api/tasks/my-tasks?pageSize=100");
      if (response.ok) {
        const payload = await response.json();
        setTasks(payload.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  const counts = useMemo(
    () => ({
      open: tasks.filter((task) => task.status === TaskStatus.OPEN).length,
      inProcess: tasks.filter((task) => task.status === TaskStatus.IN_PROCESS)
        .length,
      hold: tasks.filter((task) => task.status === TaskStatus.HOLD).length,
      overdue: tasks.filter(
        (task) =>
          task.status !== TaskStatus.CLOSED &&
          task.dueDate !== null &&
          task.dueDate.slice(0, 10) < today,
      ).length,
    }),
    [tasks, today],
  );

  const visible = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (statusFilter === "" || task.status === statusFilter) &&
          (priorityFilter === "" || task.priority === priorityFilter) &&
          (practiceFilter === "" || task.practiceId === practiceFilter) &&
          (typeFilter === "" || task.taskTypeId === typeFilter),
      ),
    [tasks, statusFilter, priorityFilter, practiceFilter, typeFilter],
  );

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Summary label="Open" count={counts.open} tone="sky" />
        <Summary label="In process" count={counts.inProcess} tone="brand" />
        <Summary label="On hold" count={counts.hold} tone="amber" />
        <Summary label="Overdue" count={counts.overdue} tone="red" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="w-auto min-w-[140px]"
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {Object.values(TaskStatus).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </Select>

        <Select
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value)}
          className="w-auto min-w-[130px]"
          aria-label="Priority"
        >
          <option value="">All priorities</option>
          {Object.values(TodoPriority).map((priority) => (
            <option key={priority} value={priority}>
              {priority.charAt(0) + priority.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>

        <Select
          value={practiceFilter}
          onChange={(event) => setPracticeFilter(event.target.value)}
          className="w-auto min-w-[160px]"
          aria-label="Practice"
        >
          <option value="">All practices</option>
          {practices.map((practice) => (
            <option key={practice.id} value={practice.id}>
              {practice.name}
            </option>
          ))}
        </Select>

        <Select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="w-auto min-w-[160px]"
          aria-label="Task type"
        >
          <option value="">All types</option>
          {taskTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </Select>

        <div className="ml-auto">
          <Button onClick={() => setAddOpen(true)}>Add task</Button>
        </div>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Nothing on your plate"
          description="Tasks assigned to you appear here."
        />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          {visible.map((task) => {
            const overdue =
              task.dueDate !== null && task.dueDate.slice(0, 10) < today;

            return (
              <li key={task.id}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {task.activeTimerStartedAt ? (
                          <span
                            title={`${task.activeTimerUserName ?? "Someone"} is timing this`}
                            className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500 align-middle"
                          />
                        ) : null}
                        {task.label}
                      </p>
                      <TaskTypeTag name={task.taskTypeName} />
                      <RecurringBadge
                        isRecurring={task.isRecurring}
                        parentTaskId={task.parentTaskId}
                        parentTaskTitle={task.parentTaskTitle}
                        instanceNumber={task.instanceNumber}
                        instanceCount={task.instanceCount}
                      />
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {task.practiceName ? (
                        <span>{task.practiceName}</span>
                      ) : (
                        <span className="text-slate-400">No practice</span>
                      )}
                      {task.dueDate ? (
                        <span className={overdue ? "font-medium text-red-700" : ""}>
                          Due {formatDate(task.dueDate)}
                        </span>
                      ) : null}
                      {task.status === TaskStatus.HOLD && task.holdReleaseDate ? (
                        <span className="text-amber-700">
                          Releases {formatDate(task.holdReleaseDate)}
                        </span>
                      ) : null}
                      {task.totalLoggedMinutes > 0 ? (
                        <span>{formatMinutes(task.totalLoggedMinutes)} logged</span>
                      ) : null}
                      {task.noteCount > 0 ? (
                        <span>
                          {task.noteCount} note{task.noteCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <Badge variant={PRIORITY_VARIANT[task.priority]}>
                    {task.priority}
                  </Badge>
                  <Badge variant={STATUS_VARIANT[task.status]}>
                    {STATUS_LABELS[task.status]}
                  </Badge>

                  <Button
                    variant="secondary"
                    onClick={() =>
                      setExpandedId((current) =>
                        current === task.id ? null : task.id,
                      )
                    }
                  >
                    {expandedId === task.id ? "Close" : "Edit"}
                  </Button>
                </div>

                {expandedId === task.id ? (
                  <TaskEditPanel
                    task={task}
                    currentUserId={currentUserId}
                    onSaved={load}
                    onClose={() => setExpandedId(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <AddTaskModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        practices={practices}
        assignableUsers={assignableUsers}
        taskTypes={taskTypes}
        currentUserId={currentUserId}
        onCreated={load}
      />
    </div>
  );
}
