"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { TaskEditPanel } from "@/components/task/TaskEditPanel";
import {
  TaskDeleteModal,
  TaskEditModal,
} from "@/components/task/TaskEditModal";
import {
  PRIORITY_VARIANT,
  RecurringBadge,
  STATUS_LABELS,
  STATUS_VARIANT,
  TaskTypeTag,
  type TaskTypeOption,
} from "@/components/task/TaskFormFields";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  isPageSize,
  Pagination,
  PAGE_SIZE_OPTIONS,
} from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { hasActiveFilters, useFilterState } from "@/lib/hooks/useFilterState";
import { useLocalSetting } from "@/lib/hooks/useLocalSetting";
import { NumericInput } from "@/components/ui/inputs/NumericInput";
import { formatMinutes } from "@/lib/task-timer-serialize";
import { TaskStatus, TodoPriority } from "@/lib/generated/prisma/enums";
import type { TaskDto } from "@/lib/task-serialize";

type SortKey =
  | "dueDate"
  | "priority"
  | "title"
  | "status"
  | "createdAt"
  | "estimatedMinutes";


/**
 * Logged time against its estimate.
 *
 * Amber once it has gone past the estimate — that is worth seeing while the
 * task is still open. Green only once a task is closed inside its estimate,
 * since an open task under budget has not finished spending yet.
 */
function loggedTone(task: TaskDto): string {
  if (task.totalLoggedMinutes === 0 || task.estimatedMinutes === null) {
    return "text-slate-700";
  }

  if (task.totalLoggedMinutes > task.estimatedMinutes) return "text-amber-700";

  return task.status === TaskStatus.CLOSED
    ? "text-emerald-700"
    : "text-slate-700";
}

/** RFC 4180 quoting — titles and notes routinely contain commas. */
function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The first of the shared page sizes — 50 rows. */
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0]!;

/** What every filter reads as when nothing is chosen. */
const FILTER_DEFAULTS = {
  status: "",
  priority: "",
  practiceId: "",
  assignedToId: "",
  createdById: "",
  taskTypeId: "",
  tag: "",
  search: "",
  from: "",
  to: "",
  overdue: false,
  recurring: false,
  sort: "dueDate",
  dir: "asc",
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
};

export function TaskListClient({
  practices,
  assignableUsers,
  taskTypes,
  canBulkEdit,
  canEditEstimate,
  canCloseWithoutTimer,
  canEditTimeDirectly,
  currentUserId,
  initial,
}: {
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  taskTypes: TaskTypeOption[];
  canBulkEdit: boolean;
  /** The estimate is the yardstick, so only PM/Owner may move it. */
  canEditEstimate: boolean;
  canCloseWithoutTimer: boolean;
  /** PM/Owner correct a time log outright; billers request an edit. */
  canEditTimeDirectly: boolean;
  currentUserId: string;
  initial: {
    assignedToId?: string;
    status?: string;
    practiceId?: string;
    /** Seeded from the URL so a dashboard count lands on what it counted. */
    overdue?: boolean;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [total, setTotal] = useState(0);
  const [storedPageSize, setStoredPageSize] = useLocalSetting(
    "tasks.list.pageSize",
    DEFAULT_PAGE_SIZE,
    isPageSize,
  );
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<TaskDto | null>(null);
  const [deletingTask, setDeletingTask] = useState<TaskDto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [editingEstimateId, setEditingEstimateId] = useState<string | null>(
    null,
  );
  const [estimateDraft, setEstimateDraft] = useState("");

  /**
   * Filters live in the URL, so opening a task and pressing back returns to
   * the same list. `initial` seeds a link that arrives already filtered — a
   * dashboard count, or the Team page — and the URL takes over from there.
   */
  const [filters, setFilters, clearFilters] = useFilterState(
    {
      ...FILTER_DEFAULTS,
      status: initial.status ?? "",
      practiceId: initial.practiceId ?? "",
      assignedToId: initial.assignedToId ?? "",
      overdue: initial.overdue ?? false,
    },
    { debounced: ["search", "tag"], pageKey: "page" },
  );

  const {
    status,
    priority,
    practiceId,
    assignedToId,
    createdById,
    taskTypeId,
    tag,
    search,
    from,
    to,
    page,
  } = filters;

  const overdueOnly = filters.overdue;
  const recurringOnly = filters.recurring;
  const pageSize = filters.limit;
  const sortKey = filters.sort as SortKey;
  const ascending = filters.dir === "asc";

  const filtersActive = hasActiveFilters(filters, FILTER_DEFAULTS, [
    "sort",
    "dir",
    "page",
    "limit",
  ]);

  // Remembered per browser; a URL naming a size wins.
  const appliedStoredSize = useRef(false);

  useEffect(() => {
    if (appliedStoredSize.current) return;
    appliedStoredSize.current = true;

    const named = new URLSearchParams(window.location.search).has("limit");
    if (!named && storedPageSize !== DEFAULT_PAGE_SIZE) {
      setFilters({ limit: storedPageSize });
    }
  }, [storedPageSize, setFilters]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortKey,
      direction: ascending ? "asc" : "desc",
    });

    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (practiceId) params.set("practiceId", practiceId);
    if (assignedToId) params.set("assignedToId", assignedToId);
    if (createdById) params.set("createdById", createdById);
    if (taskTypeId) params.set("taskTypeId", taskTypeId);
    if (tag) params.set("tag", tag);
    if (recurringOnly) params.set("recurringOnly", "true");
    if (search) params.set("search", search);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (overdueOnly) params.set("overdue", "true");

    return params.toString();
  }, [
    overdueOnly,
    page,
    pageSize,
    sortKey,
    ascending,
    status,
    priority,
    practiceId,
    assignedToId,
    createdById,
    taskTypeId,
    tag,
    recurringOnly,
    search,
    from,
    to,
  ]);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(`/api/tasks?${query}`);
      if (response.ok) {
        const payload = await response.json();
        setTasks(payload.data);
        setTotal(payload.pagination?.total ?? payload.data.length);
      }
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  // Filters change the result set, so a stale selection would act on rows the
  // user can no longer see.
  useEffect(() => {
    setSelected(new Set());
  }, [query]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // A bigger page, or a filter that shortened the list, can leave the cursor
  // past the end of it.
  useEffect(() => {
    // Only once a response has landed. Before the first fetch `total` is 0,
    // so pageCount is 1 — clamping then would throw away the page number the
    // URL just restored, which is exactly what a back navigation depends on.
    if (loading) return;

    if (page > pageCount) setFilters({ page: pageCount });
  }, [loading, page, pageCount, setFilters]);
  const allSelected =
    tasks.length > 0 && tasks.every((task) => selected.has(task.id));

  async function applyBulk() {
    if (selected.size === 0 || !bulkAction) return;

    const ids = Array.from(selected);

    const patch = bulkAction.startsWith("assign:")
      ? { assignedToId: bulkAction.slice(7) }
      : bulkAction.startsWith("priority:")
        ? { priority: bulkAction.slice(9) }
        : { status: TaskStatus.CLOSED };

    // No bulk endpoint yet — a handful of PATCHes keeps the API surface small.
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }).then((response) => response.ok),
      ),
    );

    const failed = results.filter((ok) => !ok).length;

    toast(
      failed === 0
        ? `${ids.length} task${ids.length === 1 ? "" : "s"} updated`
        : `${ids.length - failed} updated, ${failed} failed`,
      failed === 0 ? "success" : "error",
    );

    setSelected(new Set());
    setBulkAction("");
    await load();
    router.refresh();
  }

  async function saveEstimate(taskId: string) {
    const minutes = estimateDraft === "" ? null : Number(estimateDraft);

    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estimatedMinutes: minutes }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      toast(payload?.error ?? "Could not save the estimate.", "error");
      return;
    }

    setEditingEstimateId(null);
    await load();
  }

  function exportCsv() {
    const header = [
      "Task",
      "Task type",
      "Practice",
      "Assigned to",
      "Created by",
      "Due date",
      "Estimated minutes",
      "Logged minutes",
      "Priority",
      "Status",
      "Hold release",
      "Completed at",
      "Actual minutes",
      "Logged minutes",
      "Productivity count",
      "Productivity amount",
      "Recurring",
    ];

    const rows = tasks.map((task) => [
      task.label,
      task.taskTypeName ?? "",
      task.practiceName ?? "",
      task.assignedToName ?? "",
      task.createdByName ?? "",
      task.dueDate ? task.dueDate.slice(0, 10) : "",
      task.estimatedMinutes ?? "",
      task.totalLoggedMinutes || "",
      task.priority,
      STATUS_LABELS[task.status],
      task.holdReleaseDate ? task.holdReleaseDate.slice(0, 10) : "",
      task.completedAt ? task.completedAt.slice(0, 10) : "",
      task.actualMinutes ?? "",
      task.totalLoggedMinutes,
      task.productivityCount ?? "",
      task.productivityAmount ?? "",
      task.isRecurring ? "Series" : task.parentTaskId ? "Instance" : "",
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");

    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const SortHeader = ({ label, sortAs }: { label: string; sortAs: SortKey }) => (
    <button
      type="button"
      onClick={() => {
        setFilters(
          sortKey === sortAs
            ? { dir: ascending ? "desc" : "asc" }
            : { sort: sortAs, dir: "asc" },
        );
      }}
      className="inline-flex items-center gap-1 hover:text-slate-800"
    >
      {label}
      {sortKey === sortAs ? <span>{ascending ? "▲" : "▼"}</span> : null}
    </button>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Input
          value={search}
          onChange={(event) => {
            setFilters({ search: event.target.value });
          }}
          placeholder="Search titles"
          className="w-auto min-w-[180px]"
          aria-label="Search"
        />

        <Select
          value={status}
          onChange={(event) => {
            setFilters({ status: event.target.value });
          }}
          className="w-auto min-w-[140px]"
          aria-label="Status"
        >
          {/*
            The default excludes closed work, so the empty option says what it
            actually shows. Choosing "Closed" is how anyone — biller included
            — reviews what has been finished.
          */}
          <option value="">Open, in process &amp; hold</option>
          {Object.values(TaskStatus).map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </Select>

        <Select
          value={priority}
          onChange={(event) => {
            setFilters({ priority: event.target.value });
          }}
          className="w-auto min-w-[130px]"
          aria-label="Priority"
        >
          <option value="">All priorities</option>
          {Object.values(TodoPriority).map((value) => (
            <option key={value} value={value}>
              {value.charAt(0) + value.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>

        <Select
          value={practiceId}
          onChange={(event) => {
            setFilters({ practiceId: event.target.value });
          }}
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
          value={assignedToId}
          onChange={(event) => {
            setFilters({ assignedToId: event.target.value });
          }}
          className="w-auto min-w-[160px]"
          aria-label="Assigned to"
        >
          <option value="">Anyone</option>
          {assignableUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>

        <Select
          value={createdById}
          onChange={(event) => {
            setFilters({ createdById: event.target.value });
          }}
          className="w-auto min-w-[160px]"
          aria-label="Created by"
        >
          <option value="">Any creator</option>
          {assignableUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>

        <Select
          value={taskTypeId}
          onChange={(event) => {
            setFilters({ taskTypeId: event.target.value });
          }}
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

        <Input
          value={tag}
          onChange={(event) => {
            setFilters({ tag: event.target.value });
          }}
          placeholder="Tag"
          className="w-auto min-w-[120px]"
          aria-label="Tag"
        />

        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFilters({ from: event.target.value });
            }}
            className="w-auto"
            aria-label="Due from"
          />
          <span className="text-slate-400">→</span>
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setFilters({ to: event.target.value });
            }}
            className="w-auto"
            aria-label="Due to"
          />
        </div>

        <label className="flex items-center gap-2 whitespace-nowrap py-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={recurringOnly}
            onChange={(event) => {
              setFilters({ recurring: event.target.checked });
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
          Recurring only
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => {
              setFilters({ overdue: event.target.checked });
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
          Overdue only
        </label>

        {filtersActive ? (
          <Button
            variant="secondary"
            className="px-3 py-2 text-xs"
            onClick={clearFilters}
          >
            Clear all filters
          </Button>
        ) : null}

        <div className="ml-auto">
          <Button variant="secondary" onClick={exportCsv} disabled={loading}>
            Export CSV
          </Button>
        </div>
      </div>

      {canBulkEdit && selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
          <span className="text-sm text-slate-600">
            {selected.size} selected
          </span>
          <Select
            value={bulkAction}
            onChange={(event) => setBulkAction(event.target.value)}
            className="w-auto min-w-[200px]"
            aria-label="Bulk action"
          >
            <option value="">Choose an action…</option>
            <option value="close">Mark closed</option>
            {assignableUsers.map((user) => (
              <option key={user.id} value={`assign:${user.id}`}>
                Assign to {user.name}
              </option>
            ))}
            {Object.values(TodoPriority).map((value) => (
              <option key={value} value={`priority:${value}`}>
                Set priority {value.toLowerCase()}
              </option>
            ))}
          </Select>
          <Button onClick={applyBulk} disabled={!bulkAction}>
            Apply
          </Button>
        </div>
      ) : null}

      {loading ? (
        <TableSkeleton />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="No tasks match these filters"
          description="Clear a filter to widen the search."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  {canBulkEdit ? (
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? new Set(tasks.map((task) => task.id))
                              : new Set(),
                          )
                        }
                        aria-label="Select all"
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-3">
                    <SortHeader label="Title" sortAs="title" />
                  </th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Practice</th>
                  <th className="px-4 py-3">Assigned to</th>
                  <th className="px-4 py-3">
                    <SortHeader label="Due" sortAs="dueDate" />
                  </th>
                  <th className="px-4 py-3 text-right">
                    <SortHeader label="Est. Time" sortAs="estimatedMinutes" />
                  </th>
                  <th className="px-4 py-3 text-right">Logged</th>
                  <th className="px-4 py-3">
                    <SortHeader label="Priority" sortAs="priority" />
                  </th>
                  <th className="px-4 py-3">
                    <SortHeader label="Status" sortAs="status" />
                  </th>
                  <th className="px-4 py-3 text-right">Time</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((task) => (
                  <Fragment key={task.id}>
                    <tr className="hover:bg-slate-50">
                      {canBulkEdit ? (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(task.id)}
                            onChange={(event) =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(task.id);
                                else next.delete(task.id);
                                return next;
                              })
                            }
                            aria-label={`Select ${task.title}`}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        {task.activeTimerStartedAt ? (
                          <span
                            title={`${task.activeTimerUserName ?? "Someone"} is timing this`}
                            className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500 align-middle"
                          />
                        ) : null}
                        <span className="font-medium text-slate-900">
                          {task.label}
                        </span>
                        {task.productivityCount !== null ? (
                          <span className="ml-2 align-middle">
                            <Badge variant="neutral">
                              {task.productivityCount}
                            </Badge>
                          </span>
                        ) : null}
                        {task.isRecurring || task.parentTaskId ? (
                          <span className="ml-2 inline-block align-middle">
                            <RecurringBadge
                              isRecurring={task.isRecurring}
                              parentTaskId={task.parentTaskId}
                              parentTaskTitle={task.parentTaskTitle}
                              instanceNumber={task.instanceNumber}
                              instanceCount={task.instanceCount}
                            />
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <TaskTypeTag name={task.taskTypeName} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {task.practiceName ?? (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {task.assignedToName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {task.dueDate ? (
                          formatDate(task.dueDate)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {editingEstimateId === task.id ? (
                          <span className="flex items-center justify-end gap-1">
                            <NumericInput
                              value={estimateDraft}
                              onChange={setEstimateDraft}
                              maxLength={4}
                              autoFocus
                              aria-label="Estimated minutes"
                              className="w-20"
                              onKeyDown={(event) => {
                                if (event.key === "Enter") saveEstimate(task.id);
                                if (event.key === "Escape") {
                                  setEditingEstimateId(null);
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => saveEstimate(task.id)}
                              className="text-xs font-medium text-brand-700 hover:text-brand-800"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingEstimateId(null)}
                              className="text-xs text-slate-500 hover:text-slate-700"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : canEditEstimate ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEstimateId(task.id);
                              setEstimateDraft(
                                task.estimatedMinutes === null
                                  ? ""
                                  : String(task.estimatedMinutes),
                              );
                            }}
                            className="rounded px-1 hover:bg-slate-100"
                            title="Click to edit"
                          >
                            {task.estimatedMinutes === null ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              formatMinutes(task.estimatedMinutes)
                            )}
                          </button>
                        ) : task.estimatedMinutes === null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          formatMinutes(task.estimatedMinutes)
                        )}
                      </td>

                      <td
                        className={`px-4 py-3 text-right tabular-nums ${loggedTone(task)}`}
                      >
                        {task.totalLoggedMinutes === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          formatMinutes(task.totalLoggedMinutes)
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <Badge variant={PRIORITY_VARIANT[task.priority]}>
                          {task.priority}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[task.status]}>
                          {STATUS_LABELS[task.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {task.totalLoggedMinutes > 0 ? (
                          formatMinutes(task.totalLoggedMinutes)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedId((current) =>
                                current === task.id ? null : task.id,
                              )
                            }
                            className="text-sm font-medium text-brand-700 hover:text-brand-800"
                          >
                            {expandedId === task.id ? "Close" : "Work"}
                          </button>

                          {/*
                            Managers only: these reach fields the person
                            holding the task does not own, and a delete takes
                            its notes and logged time with it.
                          */}
                          {canBulkEdit ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditingTask(task)}
                                className="text-sm font-medium text-slate-600 hover:text-slate-900"
                              >
                                {task.isRecurring || task.parentTaskId
                                  ? "Edit series"
                                  : "Edit"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingTask(task)}
                                className="text-sm font-medium text-red-600 hover:text-red-700"
                              >
                                Delete
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>

                    {expandedId === task.id ? (
                      <tr>
                        <td colSpan={canBulkEdit ? 12 : 11} className="p-0">
                          <TaskEditPanel
                            task={task}
                            currentUserId={currentUserId}
                            canEditEstimate={canEditEstimate}
                            canCloseWithoutTimer={canCloseWithoutTimer}
                            canEditTimeDirectly={canEditTimeDirectly}
                            onSaved={load}
                            onClose={() => setExpandedId(null)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={page}
            totalPages={pageCount}
            totalItems={total}
            pageSize={pageSize}
            onPageChange={(next) => setFilters({ page: next })}
            onPageSizeChange={(size) => {
              setStoredPageSize(size);
              setFilters({ limit: size, page: 1 });
            }}
            noun="tasks"
            filtered={filtersActive}
          />
        </div>
      )}

      {editingTask ? (
        <TaskEditModal
          task={editingTask}
          practices={practices}
          assignableUsers={assignableUsers}
          taskTypes={taskTypes}
          onClose={() => setEditingTask(null)}
          onSaved={load}
        />
      ) : null}

      {deletingTask ? (
        <TaskDeleteModal
          task={deletingTask}
          onClose={() => setDeletingTask(null)}
          onDeleted={load}
        />
      ) : null}
    </div>
  );
}
