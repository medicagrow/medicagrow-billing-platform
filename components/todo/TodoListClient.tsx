"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AddTodoModal } from "@/components/todo/AddTodoModal";
import { TodoEditPanel } from "@/components/todo/TodoEditPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { TodoPriority, TodoStatus } from "@/lib/generated/prisma/enums";
import { TODO_STATUS_LABELS, type TodoDto } from "@/lib/todo-serialize";

type SortKey = "dueDate" | "priority" | "title" | "status" | "assignedTo";

const PAGE_SIZE = 50;

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

export function TodoListClient({
  practices,
  assignableUsers,
  canReassign,
  currentUserId,
  initialAssignedToId,
}: {
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  canReassign: boolean;
  currentUserId: string;
  initialAssignedToId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [todos, setTodos] = useState<TodoDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState("");
  const [applying, setApplying] = useState(false);

  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [practiceId, setPracticeId] = useState("");
  const [assignedToId, setAssignedToId] = useState(initialAssignedToId ?? "");
  const [search, setSearch] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [ascending, setAscending] = useState(true);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
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
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    return params.toString();
  }, [
    page,
    sortKey,
    ascending,
    status,
    priority,
    practiceId,
    assignedToId,
    search,
    isRecurring,
    isShared,
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

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
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
        if (sortKey === sortAs) setAscending((current) => !current);
        else {
          setSortKey(sortAs);
          setAscending(true);
        }
        setPage(1);
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
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search titles"
          className="w-auto min-w-[170px]"
          aria-label="Search"
        />

        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
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
            setPriority(event.target.value);
            setPage(1);
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
            setPracticeId(event.target.value);
            setPage(1);
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
              setAssignedToId(event.target.value);
              setPage(1);
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

        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Due from"
          />
          <span className="text-slate-400">→</span>
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Due to"
          />
        </div>

        <label className="flex items-center gap-2 whitespace-nowrap py-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={isRecurring}
            onChange={(event) => {
              setIsRecurring(event.target.checked);
              setPage(1);
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
              setIsShared(event.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
          Shared
        </label>

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

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>
              {total} to do{total === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <span className="tabular-nums">
                Page {page} of {pageCount}
              </span>
              <Button
                variant="secondary"
                onClick={() =>
                  setPage((current) => Math.min(pageCount, current + 1))
                }
                disabled={page >= pageCount}
              >
                Next
              </Button>
            </div>
          </div>
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
