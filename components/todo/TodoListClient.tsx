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
import { AddTodoModal } from "@/components/todo/AddTodoModal";
import { TodoEditPanel } from "@/components/todo/TodoEditPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  isPageSize,
  Pagination,
  PAGE_SIZE_OPTIONS,
} from "@/components/ui/Pagination";
import {
  DueDateFilters,
  dueDateParams,
  type DueQuickFilter,
} from "@/components/ui/DueDateFilters";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { hasActiveFilters, useFilterState } from "@/lib/hooks/useFilterState";
import { useLocalSetting } from "@/lib/hooks/useLocalSetting";
import { TodoPriority, TodoStatus } from "@/lib/generated/prisma/enums";
import { TODO_STATUS_LABELS, type TodoDto } from "@/lib/todo-serialize";

type SortKey = "dueDate" | "priority" | "title" | "status" | "assignedTo";


const PRIORITY_VARIANT: Record<
  TodoPriority,
  "red" | "amber" | "sky" | "neutral"
> = {
  URGENT: "red",
  HIGH: "amber",
  MEDIUM: "sky",
  LOW: "neutral",
};

const STATUS_VARIANT: Record<
  TodoStatus,
  "sky" | "brand" | "amber" | "neutral"
> = {
  OPEN: "sky",
  IN_PROCESS: "brand",
  HOLD: "amber",
  CLOSED: "neutral",
};

/** The first of the shared page sizes — 50 rows. */
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0]!;

/** What every filter reads as when nothing is chosen. */
const FILTER_DEFAULTS = {
  status: "",
  priority: "",
  practiceId: "",
  assignedToId: "",
  search: "",
  from: "",
  to: "",
  due: "none",
  recurring: false,
  shared: false,
  sort: "dueDate",
  dir: "asc",
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
};

export function TodoListClient({
  practices,
  assignableUsers,
  canReassign,
  currentUserId,
  initialAssignedToId,
  initialDueQuick = "none",
}: {
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  canReassign: boolean;
  currentUserId: string;
  initialAssignedToId?: string;
  /** Seeded from the URL so a dashboard count lands on what it counted. */
  initialDueQuick?: DueQuickFilter;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [todos, setTodos] = useState<TodoDto[]>([]);
  const [total, setTotal] = useState(0);
  const [storedPageSize, setStoredPageSize] = useLocalSetting(
    "todos.list.pageSize",
    DEFAULT_PAGE_SIZE,
    isPageSize,
  );
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState("");
  const [applying, setApplying] = useState(false);

  /**
   * Filters live in the URL, so opening a to do and pressing back returns to
   * the same list. The `initial*` props seed a link that arrives already
   * filtered, and the URL takes over from there.
   */
  const [filters, setFilters, clearFilters] = useFilterState(
    {
      ...FILTER_DEFAULTS,
      assignedToId: initialAssignedToId ?? "",
      due: initialDueQuick as string,
    },
    { debounced: ["search"], pageKey: "page" },
  );

  const {
    status,
    priority,
    practiceId,
    assignedToId,
    search,
    from,
    to,
    page,
  } = filters;

  const isRecurring = filters.recurring;
  const isShared = filters.shared;
  const dueQuick = filters.due as DueQuickFilter;
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
    if (search) params.set("search", search);
    if (isRecurring) params.set("isRecurring", "true");
    if (isShared) params.set("isShared", "true");
    // The quick filters set their own bound, so they replace the range.
    for (const [key, value] of Object.entries(
      dueDateParams(dueQuick, from, to),
    )) {
      params.set(key, value);
    }

    return params.toString();
  }, [
    page,
    pageSize,
    sortKey,
    ascending,
    status,
    priority,
    practiceId,
    assignedToId,
    search,
    isRecurring,
    isShared,
    dueQuick,
    from,
    to,
  ]);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(`/api/todos?${query}`);
      if (response.ok) {
        const payload = await response.json();
        setTodos(payload.data);
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

  // A bigger page can leave the cursor past the end of the list.
  useEffect(() => {
    // Only once a response has landed. Before the first fetch `total` is 0,
    // so pageCount is 1 — clamping then would throw away the page number the
    // URL just restored, which is exactly what a back navigation depends on.
    if (loading) return;

    if (page > pageCount) setFilters({ page: pageCount });
  }, [loading, page, pageCount, setFilters]);
  const allSelected =
    todos.length > 0 && todos.every((todo) => selected.has(todo.id));

  async function applyBulk() {
    if (selected.size === 0 || !bulkAction) return;

    const ids = Array.from(selected);

    // Deleting is a soft delete: the productivity module reports on completion
    // history, and a hard delete would rewrite it.
    const patch = bulkAction.startsWith("assign:")
      ? { assignedToId: bulkAction.slice(7) }
      : bulkAction.startsWith("status:")
        ? { status: bulkAction.slice(7) }
        : { status: TodoStatus.CLOSED, note: "Bulk deleted" };

    // A held to do needs a release date, so bulk-holding is not offered.
    setApplying(true);

    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/todos/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          }).then((response) => response.ok),
        ),
      );

      const failed = results.filter((ok) => !ok).length;

      toast(
        failed === 0
          ? `${ids.length} to do${ids.length === 1 ? "" : "s"} updated`
          : `${ids.length - failed} updated, ${failed} failed`,
        failed === 0 ? "success" : "error",
      );

      setSelected(new Set());
      setBulkAction("");
      await load();
      router.refresh();
    } finally {
      setApplying(false);
    }
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
          className="w-auto min-w-[170px]"
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
          <option value="">All statuses</option>
          {Object.values(TodoStatus).map((value) => (
            <option key={value} value={value}>
              {TODO_STATUS_LABELS[value]}
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

        {canReassign ? (
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
        ) : null}

        <DueDateFilters
          quick={dueQuick}
          onQuickChange={(next) => {
            setFilters({ due: next });
          }}
          from={from}
          to={to}
          onFromChange={(value) => {
            setFilters({ from: value });
          }}
          onToChange={(value) => {
            setFilters({ to: value });
          }}
        />

        <label className="flex items-center gap-2 whitespace-nowrap py-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={isRecurring}
            onChange={(event) => {
              setFilters({ recurring: event.target.checked });
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
          Recurring
        </label>

        <label className="flex items-center gap-2 whitespace-nowrap py-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={isShared}
            onChange={(event) => {
              setFilters({ shared: event.target.checked });
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
          Shared
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
          <Button onClick={() => setAddOpen(true)}>Add to do</Button>
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
          <span className="text-sm text-slate-600">
            {selected.size} selected
          </span>

          <Select
            value={bulkAction}
            onChange={(event) => setBulkAction(event.target.value)}
            className="w-auto min-w-[220px]"
            aria-label="Bulk action"
          >
            <option value="">Choose an action…</option>
            <option value="delete">Delete selected</option>
            {/* Hold is left out: each held item needs its own release date. */}
            {[TodoStatus.OPEN, TodoStatus.IN_PROCESS, TodoStatus.CLOSED].map(
              (value) => (
                <option key={value} value={`status:${value}`}>
                  Change status to {TODO_STATUS_LABELS[value]}
                </option>
              ),
            )}
            {canReassign
              ? assignableUsers.map((user) => (
                  <option key={user.id} value={`assign:${user.id}`}>
                    Reassign to {user.name}
                  </option>
                ))
              : null}
          </Select>

          <Button onClick={applyBulk} disabled={!bulkAction || applying}>
            {applying ? "Applying…" : "Apply"}
          </Button>

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Clear
          </button>
        </div>
      ) : null}

      {loading ? (
        <TableSkeleton />
      ) : todos.length === 0 ? (
        <EmptyState
          title="No to dos match these filters"
          description="Clear a filter to widen the search."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? new Set(todos.map((todo) => todo.id))
                            : new Set(),
                        )
                      }
                      aria-label="Select all"
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </th>
                  <th className="px-4 py-3">
                    <SortHeader label="Title" sortAs="title" />
                  </th>
                  <th className="px-4 py-3">Practice</th>
                  <th className="px-4 py-3">
                    <SortHeader label="Assigned to" sortAs="assignedTo" />
                  </th>
                  <th className="px-4 py-3">
                    <SortHeader label="Due" sortAs="dueDate" />
                  </th>
                  <th className="px-4 py-3">
                    <SortHeader label="Priority" sortAs="priority" />
                  </th>
                  <th className="px-4 py-3">
                    <SortHeader label="Status" sortAs="status" />
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {todos.map((todo) => (
                  <Fragment key={todo.id}>
                    <tr className="hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(todo.id)}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(todo.id);
                              else next.delete(todo.id);
                              return next;
                            })
                          }
                          aria-label={`Select ${todo.title}`}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-900">
                          {todo.title}
                        </span>
                        <span className="ml-2 inline-flex gap-1 align-middle">
                          {todo.isRecurring ? (
                            <Badge variant="sky">↻ Recurring</Badge>
                          ) : null}
                          {todo.isShared ? (
                            <Badge variant="neutral">Shared</Badge>
                          ) : null}
                          {todo.subAssignedToId ? (
                            <Badge variant="amber">
                              {todo.subAssignedToId === currentUserId
                                ? `Sub-assigned from ${todo.assignedToName ?? "—"}`
                                : `Sub-assigned to ${todo.subAssignedToName ?? "—"}`}
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {todo.practiceName ?? (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {todo.assignedToName ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {todo.dueDate ? (
                          formatDate(todo.dueDate)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={PRIORITY_VARIANT[todo.priority]}>
                          {todo.priority}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[todo.status]}>
                          {TODO_STATUS_LABELS[todo.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId((current) =>
                              current === todo.id ? null : todo.id,
                            )
                          }
                          className="text-sm font-medium text-brand-700 hover:text-brand-800"
                        >
                          {expandedId === todo.id ? "Close" : "Edit"}
                        </button>
                      </td>
                    </tr>

                    {expandedId === todo.id ? (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <TodoEditPanel
                            todo={todo}
                            practices={practices}
                            assignableUsers={assignableUsers}
                            canSubAssign={canReassign}
                            currentUserId={currentUserId}
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
            noun="to dos"
            filtered={filtersActive}
          />
        </div>
      )}

      <AddTodoModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        practices={practices}
        assignableUsers={assignableUsers}
        currentUserId={currentUserId}
        onCreated={load}
      />
    </div>
  );
}
