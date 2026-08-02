"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { AddTodoModal } from "@/components/todo/AddTodoModal";
import { BlockDayEditor } from "@/components/todo/BlockDayEditor";
import {
  BLOCK_COLORS,
  DayScheduleGrid,
  type ScheduleBlock,
} from "@/components/todo/DayScheduleGrid";
import { TodoEditPanel } from "@/components/todo/TodoEditPanel";
import { TimeBlockModal } from "@/components/todo/TimeBlockModal";
import { useToast } from "@/components/ui/toast";
import type { TodoDto } from "@/lib/todo-serialize";
import { TimeBlockType, TodoPriority, TodoStatus } from "@/lib/generated/prisma/enums";

const PRIORITY_VARIANT: Record<TodoPriority, "red" | "amber" | "sky" | "neutral"> = {
  URGENT: "red",
  HIGH: "amber",
  MEDIUM: "sky",
  LOW: "neutral",
};

interface TimeBlockDto {
  id: string;
  dayOfWeek: number | null;
  specificDate: string | null;
  startTime: string;
  endTime: string;
  label: string;
  blockType: TimeBlockType;
  color: string | null;
  /** True when the row only applies to the date being viewed. */
  isOverride?: boolean;
  /** The weekly-template block this replaces, if any. */
  overridesBlockId?: string | null;
}

const formatIsoDate = (iso: string) => {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Shifts a YYYY-MM-DD string by whole days, staying in UTC. */
function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface UpcomingDay {
  date: string;
  count: number;
  minutes: number;
}

const formatMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

/**
 * When a todo is due, in the words a planner reads.
 *
 * Compared as YYYY-MM-DD strings against the real today — not the viewed day,
 * since "overdue" means overdue now regardless of which day is on screen.
 */
function DueDateLine({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return null;

  const due = dueDate.slice(0, 10);
  const now = todayIso();

  const [tone, text] =
    due === now
      ? ["text-emerald-600", "Due today"]
      : due < now
        ? ["text-red-600", `Overdue — ${formatIsoDate(due)}`]
        : ["text-slate-500", formatIsoDate(due)];

  return <p className={`mt-0.5 text-xs ${tone}`}>{text}</p>;
}

export function MyDayClient({
  practices,
  assignableUsers,
  userId,
}: {
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  userId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [todos, setTodos] = useState<TodoDto[]>([]);
  const [blocks, setBlocks] = useState<TimeBlockDto[]>([]);
  const [capacity, setCapacity] = useState({
    availableMinutes: 0,
    plannedMinutes: 0,
    overCapacity: false,
  });
  const [upcoming, setUpcoming] = useState<UpcomingDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dayHasOverrides, setDayHasOverrides] = useState(false);
  const [hiddenBlockCount, setHiddenBlockCount] = useState(0);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  /**
   * The viewed day lives in the URL, so a particular day can be linked,
   * bookmarked and reached with the back button. An absent or malformed
   * ?date= falls back to today rather than erroring.
   */
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");

  const viewDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayIso();

  const setViewDate = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());

      // Today is the default, so it needs no param cluttering the URL.
      if (next === todayIso()) params.delete("date");
      else params.set("date", next);

      const query = params.toString();
      router.push(query ? `/todos?${query}` : "/todos");
    },
    [router, searchParams],
  );

  const canSubAssign = assignableUsers.length > 1;

  const today = viewDate;
  const isToday = viewDate === todayIso();
  const isPast = viewDate < todayIso();

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const [todayRes, upcomingRes] = await Promise.all([
        fetch(`/api/todos/today?date=${today}`),
        fetch(
          `/api/todos?assignedToId=${userId}&from=${today}&pageSize=100&status=OPEN`,
        ),
      ]);

      if (todayRes.ok) {
        const payload = await todayRes.json();
        setTodos(payload.data);
        setBlocks(payload.blocks);
        setCapacity(payload.capacity);
        setDayHasOverrides(payload.hasOverrides ?? false);
        setHiddenBlockCount(payload.hiddenBlockCount ?? 0);
      }

      if (upcomingRes.ok) {
        const payload = await upcomingRes.json();
        const byDate = new Map<string, UpcomingDay>();

        for (const todo of payload.data as TodoDto[]) {
          if (!todo.dueDate) continue;
          const date = todo.dueDate.slice(0, 10);
          if (date <= today) continue;

          const existing = byDate.get(date) ?? { date, count: 0, minutes: 0 };
          existing.count += 1;
          existing.minutes += todo.estimatedMinutes ?? 0;
          byDate.set(date, existing);
        }

        setUpcoming(
          Array.from(byDate.values())
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(0, 7),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [today, userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateTodo(todoId: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/todos/${todoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      toast(payload?.error ?? "Could not update the task.", "error");
      return;
    }

    if (payload?.nextInstanceId) {
      toast("Done — next occurrence scheduled");
    }

    await load();
    router.refresh();
  }

  const todayLabel = new Date(`${today}T00:00:00.000Z`).toLocaleDateString(
    undefined,
    { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" },
  );

  /** Replaces or hides one template block on the viewed date only. */
  async function overrideBlock(
    blockId: string,
    body: Record<string, unknown>,
  ) {
    const response = await fetch("/api/time-blocks/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockId, date: viewDate, ...body }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      toast(payload?.error ?? "Could not change today's schedule.", "error");
      return false;
    }

    await load();
    return true;
  }

  /** Removes a block from this date: an override for template rows, an
   *  outright delete for a one-off that only ever applied here. */
  async function removeBlockForDay(block: ScheduleBlock) {
    if (block.specificDate && !block.overridesBlockId) {
      const response = await fetch(`/api/time-blocks/${block.id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast("Block removed");
        await load();
      }
      return;
    }

    const target = block.overridesBlockId ?? block.id;
    if (await overrideBlock(target, { hide: true })) {
      toast("Removed from this day only");
    }
  }

  async function restoreDefaults() {
    const response = await fetch(
      `/api/time-blocks/overrides?date=${viewDate}`,
      { method: "DELETE" },
    );

    if (response.ok) {
      toast("Weekly schedule restored for this day");
      await load();
    }
  }

  return (
    <>
      {/* Editing the schedule is a page-level action, not part of the panel
          it happens to affect. */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            My Day
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setViewDate(shiftDate(viewDate, -1))}
              className="rounded-md px-2 py-1 text-sm text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
              aria-label="Previous day"
            >
              ←
            </button>
            <span className="text-sm text-slate-700">{todayLabel}</span>
            <button
              type="button"
              onClick={() => setViewDate(shiftDate(viewDate, 1))}
              className="rounded-md px-2 py-1 text-sm text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
              aria-label="Next day"
            >
              →
            </button>
            {isToday ? null : (
              <button
                type="button"
                onClick={() => setViewDate(todayIso())}
                className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
              >
                Today
              </button>
            )}
            {isPast ? <Badge variant="neutral">Past day — read only</Badge> : null}
          </div>
        </div>
        <div className="shrink-0">
          <TimeBlockModal onSaved={load} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
      {/* ------------------------- schedule (40%) ------------------------- */}
      <div className="lg:col-span-2">
        <div className="rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              {isToday ? "Today's schedule" : "Schedule"}
            </h3>

          </div>

          <div className="p-4">
            {blocks.length === 0 ? (
              <EmptyState
                title="No schedule set"
                description="Set up your standard day once and it repeats every week."
              />
            ) : (
              <DayScheduleGrid
                blocks={blocks}
                readOnly={isPast}
                onEdit={(block) => setEditingBlockId(block.id)}
                onRemove={removeBlockForDay}
              />
            )}

            {dayHasOverrides && !isPast ? (
              <p className="mt-2 text-xs text-slate-500">
                {hiddenBlockCount > 0
                  ? `${hiddenBlockCount} block${hiddenBlockCount === 1 ? "" : "s"} hidden today`
                  : "This day differs from your weekly schedule"}
                {" — "}
                <button
                  type="button"
                  onClick={restoreDefaults}
                  className="font-medium text-brand-700 hover:text-brand-800"
                >
                  Restore all
                </button>
              </p>
            ) : null}

            {blocks.length > 0 && !isPast ? (
              <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                {blocks.map((block) =>
                  editingBlockId === block.id ? (
                    <li key={block.id}>
                      <BlockDayEditor
                        block={block}
                        onCancel={() => setEditingBlockId(null)}
                        onSave={async (patch) => {
                          const target = block.overridesBlockId ?? block.id;

                          // A one-off block has no template behind it, so it
                          // is edited in place rather than overridden.
                          const ok =
                            block.specificDate && !block.overridesBlockId
                              ? await fetch(`/api/time-blocks/${block.id}`, {
                                  method: "PATCH",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify(patch),
                                })
                                  .then((response) => response.ok)
                                  .then(async (okay) => {
                                    if (okay) await load();
                                    return okay;
                                  })
                              : await overrideBlock(target, patch);

                          if (ok) {
                            setEditingBlockId(null);
                            toast("Schedule updated for this day");
                          }
                        }}
                      />
                    </li>
                  ) : (
                    <li
                      key={block.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${BLOCK_COLORS[block.blockType]}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-slate-700">
                        {block.label}
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        {block.startTime}–{block.endTime}
                      </span>
                      {block.isOverride ? (
                        <Badge variant="amber">Today only</Badge>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setEditingBlockId(block.id)}
                        aria-label={`Edit ${block.label}`}
                        className="shrink-0 rounded px-1 text-slate-400 hover:text-brand-700"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBlockForDay(block)}
                        aria-label={`Remove ${block.label} from this day`}
                        className="shrink-0 rounded px-1 text-slate-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    </li>
                  ),
                )}
              </ul>
            ) : null}
          </div>
        </div>

        {/* ---------------------------- upcoming ---------------------------- */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Upcoming
              <span className="ml-2 text-xs font-normal text-slate-500">
                next 7 days
              </span>
            </h3>
          </div>
          <div className="px-4 py-3">
            {upcoming.length === 0 ? (
              <p className="text-xs text-slate-500">Nothing scheduled ahead.</p>
            ) : (
              <ul className="space-y-1.5">
                {upcoming.map((day) => (
                  <li
                    key={day.date}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
                  >
                    <span className="text-slate-700">
                      {new Date(`${day.date}T00:00:00Z`).toLocaleDateString(
                        "en-US",
                        { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" },
                      )}
                    </span>
                    <span className="text-xs tabular-nums text-slate-500">
                      {day.count} task{day.count === 1 ? "" : "s"}
                      {day.minutes > 0 ? ` · ${formatMinutes(day.minutes)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* --------------------------- todos (60%) --------------------------- */}
      <div className="lg:col-span-3">
        <div className="rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatMinutes(capacity.plannedMinutes)} planned of{" "}
                {formatMinutes(capacity.availableMinutes)} available
              </p>
            </div>
            {isPast ? null : (
              <Button
                className="px-2.5 py-1 text-xs"
                onClick={() => setAddOpen(true)}
              >
                Add to do
              </Button>
            )}
          </div>

          {capacity.overCapacity ? (
            <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
              Your todos exceed available work time today by{" "}
              {formatMinutes(
                capacity.plannedMinutes - capacity.availableMinutes,
              )}
              .
            </p>
          ) : null}

          <div className="px-4 py-3">
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : todos.length === 0 ? (
              <EmptyState
                title="Nothing planned for today"
                description="Add a task, or pull one forward from Upcoming."
              />
            ) : (
              <ul className="space-y-2">
                {todos.map((todo) => {
                  const done = todo.status === TodoStatus.CLOSED;

                  return (
                    <li
                      key={todo.id}
                      className={`rounded-lg border p-3 ${
                        done
                          ? "border-slate-200 bg-slate-50/60"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={() =>
                            updateTodo(todo.id, {
                              status: done ? TodoStatus.OPEN : TodoStatus.CLOSED,
                            })
                          }
                          aria-label={`Mark ${todo.title} ${done ? "not done" : "done"}`}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                        />

                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded(expanded === todo.id ? null : todo.id)
                            }
                            className="block w-full text-left"
                          >
                            <span
                              className={`text-sm font-medium ${
                                done
                                  ? "text-slate-400 line-through"
                                  : "text-slate-900"
                              }`}
                            >
                              {todo.title}
                            </span>
                          </button>

                          <DueDateLine dueDate={todo.dueDate} />

                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant={PRIORITY_VARIANT[todo.priority]}>
                              {todo.priority}
                            </Badge>
                            {todo.practiceName ? (
                              <Badge variant="neutral">{todo.practiceName}</Badge>
                            ) : null}
                            {todo.estimatedMinutes ? (
                              <span className="text-[11px] text-slate-500">
                                {formatMinutes(todo.estimatedMinutes)}
                              </span>
                            ) : null}
                            {todo.status === TodoStatus.IN_PROCESS ? (
                              <Badge variant="brand">In progress</Badge>
                            ) : null}
                          </div>


                        </div>

                        <Button
                          variant="secondary"
                          className="shrink-0 px-2.5 py-1 text-xs"
                          onClick={() =>
                            setExpanded(expanded === todo.id ? null : todo.id)
                          }
                        >
                          {expanded === todo.id ? "Close" : "Edit"}
                        </Button>
                      </div>

                      {/* The same panel the list view uses — one edit surface,
                          so the two cannot drift on which fields exist. */}
                      {expanded === todo.id ? (
                        <div className="-mx-3 -mb-3 mt-3">
                          <TodoEditPanel
                            todo={todo}
                            practices={practices}
                            assignableUsers={assignableUsers}
                            canSubAssign={canSubAssign}
                            currentUserId={userId}
                            onSaved={load}
                            onClose={() => setExpanded(null)}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
      </div>

      <AddTodoModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        practices={practices}
        assignableUsers={assignableUsers}
        currentUserId={userId}
        defaultDate={today}
        onCreated={load}
      />
    </>
  );
}

