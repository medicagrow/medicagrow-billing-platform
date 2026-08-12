"use client";

import { Badge } from "@/components/ui/Badge";
import { Input, Label } from "@/components/ui/Input";
import { NumericInput } from "@/components/ui/inputs/NumericInput";
import { PracticeField } from "@/components/ui/PracticeField";
import {
  DAILY_HOURS_STEP,
  MAX_DAILY_HOURS,
  MIN_DAILY_HOURS,
  usesDailyHours,
} from "@/lib/task/daily-hours";
import { Select } from "@/components/ui/Select";
import { TaskStatus, TodoPriority } from "@/lib/generated/prisma/enums";
import {
  DAY_NAMES,
  FREQUENCY_LABELS,
  WEEKDAYS,
  type RecurringFrequency,
} from "@/lib/task/recurrence-config";

export interface TaskTypeOption {
  id: string;
  name: string;
}

export interface TaskFormValues {
  description: string;
  practiceId: string;
  taskTypeId: string;
  assignedToId: string;
  dueDate: string;
  /** Claim Follow-up only — a range and a rate, not a deadline. */
  startDate: string;
  dailyHours: string;
  estimatedMinutes: string;
  priority: TodoPriority;
  status: TaskStatus;
  holdReleaseDate: string;
  isVisibleToCreator: boolean;

  isRecurring: boolean;
  frequency: RecurringFrequency;
  daysOfWeek: number[];
  dayOfMonth: string;
  nextDueDate: string;
  endDate: string;
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Open",
  IN_PROCESS: "In Process",
  HOLD: "Hold",
  CLOSED: "Closed",
};

export const STATUS_VARIANT: Record<
  TaskStatus,
  "sky" | "brand" | "amber" | "neutral"
> = {
  OPEN: "sky",
  IN_PROCESS: "brand",
  HOLD: "amber",
  CLOSED: "neutral",
};

export const PRIORITY_VARIANT: Record<
  TodoPriority,
  "red" | "amber" | "sky" | "neutral"
> = {
  URGENT: "red",
  HIGH: "amber",
  MEDIUM: "sky",
  LOW: "neutral",
};

export function emptyTaskForm(assignedToId: string): TaskFormValues {
  return {
    description: "",
    practiceId: "",
    taskTypeId: "",
    assignedToId,
    dueDate: "",
    startDate: "",
    dailyHours: "",
    estimatedMinutes: "",
    priority: TodoPriority.MEDIUM,
    status: TaskStatus.OPEN,
    holdReleaseDate: "",
    isVisibleToCreator: true,
    isRecurring: false,
    frequency: "weekly",
    daysOfWeek: WEEKDAYS,
    dayOfMonth: "1",
    nextDueDate: "",
    endDate: "",
  };
}

/**
 * The recurrence payload the API expects, or undefined when the task is not
 * recurring. Kept beside the form values so create and edit build it the
 * same way.
 */
export function recurringConfigFrom(values: TaskFormValues) {
  if (!values.isRecurring || values.nextDueDate === "") return undefined;

  const weekly =
    values.frequency === "weekly" || values.frequency === "biweekly";

  return {
    frequency: values.frequency,
    ...(weekly ? { daysOfWeek: values.daysOfWeek } : {}),
    ...(values.frequency === "monthly"
      ? { dayOfMonth: Number(values.dayOfMonth || 1) }
      : {}),
    nextDueDate: values.nextDueDate,
    ...(values.endDate ? { endDate: values.endDate } : {}),
  };
}

/** Small tag shown beside a task title in every list view. */
export function TaskTypeTag({ name }: { name: string | null }) {
  if (!name) return null;
  return <Badge variant="violet">{name}</Badge>;
}

/** Recurrence marker: parents show the series size, instances their number. */
export function RecurringBadge({
  isRecurring,
  parentTaskId,
  parentTaskTitle,
  instanceNumber,
  instanceCount,
}: {
  isRecurring: boolean;
  parentTaskId: string | null;
  parentTaskTitle?: string | null;
  instanceNumber?: number | null;
  instanceCount?: number;
}) {
  if (isRecurring) {
    return (
      <Badge variant="sky">
        ↻ {instanceCount ?? 0} instance{instanceCount === 1 ? "" : "s"}
      </Badge>
    );
  }

  if (!parentTaskId) return null;

  return (
    <Badge variant="sky">
      ↻ Instance #{instanceNumber ?? "?"}
      {parentTaskTitle ? ` of ${parentTaskTitle}` : ""}
    </Badge>
  );
}

/** The status selector plus the hold release date it gates. */
export function StatusFields({
  values,
  onChange,
  disabled,
  idPrefix = "",
}: {
  values: Pick<TaskFormValues, "status" | "holdReleaseDate">;
  onChange: <K extends keyof TaskFormValues>(
    key: K,
    value: TaskFormValues[K],
  ) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const onHold = values.status === TaskStatus.HOLD;

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}status`}>Status</Label>
        <Select
          id={`${idPrefix}status`}
          value={values.status}
          onChange={(event) =>
            onChange("status", event.target.value as TaskStatus)
          }
          disabled={disabled}
        >
          {Object.values(TaskStatus).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      {/* A held task must say when it comes back, or it disappears silently. */}
      {onHold ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}holdReleaseDate`}>
            Release from hold on
          </Label>
          <Input
            id={`${idPrefix}holdReleaseDate`}
            type="date"
            required
            value={values.holdReleaseDate}
            onChange={(event) => onChange("holdReleaseDate", event.target.value)}
            disabled={disabled}
          />
          <p className="text-xs text-slate-500">
            It returns to Open automatically on this date.
          </p>
        </div>
      ) : null}
    </>
  );
}

/** The recurrence toggle and the fields it reveals. */
export function RecurrenceFields({
  values,
  onChange,
  disabled,
  idPrefix = "",
}: {
  values: TaskFormValues;
  onChange: <K extends keyof TaskFormValues>(
    key: K,
    value: TaskFormValues[K],
  ) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const weekly =
    values.frequency === "weekly" || values.frequency === "biweekly";

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={values.isRecurring}
          onChange={(event) => onChange("isRecurring", event.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-slate-300"
        />
        Recurring task
      </label>

      {values.isRecurring ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}frequency`}>Frequency</Label>
              <Select
                id={`${idPrefix}frequency`}
                value={values.frequency}
                onChange={(event) =>
                  onChange(
                    "frequency",
                    event.target.value as RecurringFrequency,
                  )
                }
                disabled={disabled}
              >
                {(Object.keys(FREQUENCY_LABELS) as RecurringFrequency[]).map(
                  (option) => (
                    <option key={option} value={option}>
                      {FREQUENCY_LABELS[option]}
                    </option>
                  ),
                )}
              </Select>
            </div>

            {values.frequency === "monthly" ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}dayOfMonth`}>Day of month</Label>
                <NumericInput
                  id={`${idPrefix}dayOfMonth`}
                  maxLength={2}
                  value={values.dayOfMonth}
                  onChange={(next) => onChange("dayOfMonth", next)}
                  disabled={disabled}
                />
                <p className="text-xs text-slate-500">
                  1–28, so every month has the day.
                </p>
              </div>
            ) : null}
          </div>

          {weekly ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`${idPrefix}days`}>Days</Label>
                <button
                  type="button"
                  onClick={() => onChange("daysOfWeek", WEEKDAYS)}
                  disabled={disabled}
                  className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
                >
                  Weekdays
                </button>
              </div>
              <div id={`${idPrefix}days`} className="flex flex-wrap gap-1">
                {DAY_NAMES.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() =>
                      onChange(
                        "daysOfWeek",
                        values.daysOfWeek.includes(index)
                          ? values.daysOfWeek.filter((day) => day !== index)
                          : [...values.daysOfWeek, index].sort((a, b) => a - b),
                      )
                    }
                    disabled={disabled}
                    aria-pressed={values.daysOfWeek.includes(index)}
                    className={`rounded-md px-2.5 py-1 text-xs ring-1 ring-inset ${
                      values.daysOfWeek.includes(index)
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}nextDueDate`}>First occurrence</Label>
              <Input
                id={`${idPrefix}nextDueDate`}
                type="date"
                value={values.nextDueDate}
                onChange={(event) =>
                  onChange("nextDueDate", event.target.value)
                }
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}endDate`}>End date (optional)</Label>
              <Input
                id={`${idPrefix}endDate`}
                type="date"
                value={values.endDate}
                onChange={(event) => onChange("endDate", event.target.value)}
                disabled={disabled}
              />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            The first three occurrences are created straight away; completing
            one adds the next.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** The shared body of the add and edit forms. */
export function TaskFormFields({
  values,
  onChange,
  practices,
  assignableUsers,
  taskTypes,
  disabled,
  showVisibility,
  showRecurrence = true,
  idPrefix = "",
}: {
  values: TaskFormValues;
  onChange: <K extends keyof TaskFormValues>(
    key: K,
    value: TaskFormValues[K],
  ) => void;
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  taskTypes: TaskTypeOption[];
  disabled?: boolean;
  /** Only meaningful when assigning to somebody else. */
  showVisibility: boolean;
  showRecurrence?: boolean;
  idPrefix?: string;
}) {
  /**
   * Whether this task type spreads over a range. Read from the selected type's
   * name rather than a flag on the option, so the one rule in
   * lib/task/daily-hours.ts decides it for the form and the planner alike.
   */
  const spreadsOverDays = usesDailyHours(
    taskTypes.find((type) => type.id === values.taskTypeId)?.name,
  );

  return (
    <div className="space-y-4">
      {/* Type identifies the task, so it leads and it is required. */}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}taskTypeId`}>
          Task type <span className="text-red-600">*</span>
        </Label>
        <Select
          id={`${idPrefix}taskTypeId`}
          value={values.taskTypeId}
          onChange={(event) => onChange("taskTypeId", event.target.value)}
          disabled={disabled}
          required
        >
          <option value="">Select a task type…</option>
          {taskTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </Select>
      </div>

      <PracticeField
        id={`${idPrefix}practiceId`}
        value={values.practiceId}
        onChange={(practiceId) => onChange("practiceId", practiceId)}
        practices={practices}
        disabled={disabled}
        required={false}
      />

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}description`}>Description</Label>
        <textarea
          id={`${idPrefix}description`}
          value={values.description}
          onChange={(event) => onChange("description", event.target.value)}
          disabled={disabled}
          rows={3}
          maxLength={4000}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}assignedToId`}>Assigned to</Label>
          <Select
            id={`${idPrefix}assignedToId`}
            value={values.assignedToId}
            onChange={(event) => onChange("assignedToId", event.target.value)}
            disabled={disabled || assignableUsers.length <= 1}
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
        {/* A recurring parent takes its dates from the recurrence pattern. */}
        {values.isRecurring ? null : (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}dueDate`}>Due date</Label>
            <Input
              id={`${idPrefix}dueDate`}
              type="date"
              value={values.dueDate}
              onChange={(event) => onChange("dueDate", event.target.value)}
              disabled={disabled}
            />
          </div>
        )}

        {/*
          AR follow-up is a rate over a range rather than a deadline, so it
          gets a start and an hours-per-day. Hidden for every other task type:
          two fields that mean nothing on a charge-posting task are two fields
          somebody has to learn to ignore.
        */}
        {spreadsOverDays ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}startDate`}>Work starts from</Label>
              <Input
                id={`${idPrefix}startDate`}
                type="date"
                value={values.startDate}
                max={values.dueDate || undefined}
                onChange={(event) => onChange("startDate", event.target.value)}
                disabled={disabled}
              />
              <p className="text-xs text-slate-500">
                Defaults to today. Must be on or before the due date.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}dailyHours`}>
                Daily hours allocated
              </Label>
              <Input
                id={`${idPrefix}dailyHours`}
                type="number"
                inputMode="decimal"
                min={MIN_DAILY_HOURS}
                max={MAX_DAILY_HOURS}
                step={DAILY_HOURS_STEP}
                value={values.dailyHours}
                onChange={(event) => onChange("dailyHours", event.target.value)}
                disabled={disabled}
                placeholder="—"
              />
              <p className="text-xs text-slate-500">
                How many hours per day should this biller spend on this
                project&rsquo;s AR follow-up?
              </p>
            </div>
          </>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}estimatedMinutes`}>
            Estimated minutes
          </Label>
          <NumericInput
            id={`${idPrefix}estimatedMinutes`}
            maxLength={4}
            value={values.estimatedMinutes}
            onChange={(next) => onChange("estimatedMinutes", next)}
            disabled={disabled}
            placeholder="—"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}priority`}>Priority</Label>
          <Select
            id={`${idPrefix}priority`}
            value={values.priority}
            onChange={(event) =>
              onChange("priority", event.target.value as TodoPriority)
            }
            disabled={disabled}
          >
            {Object.values(TodoPriority).map((priority) => (
              <option key={priority} value={priority}>
                {priority.charAt(0) + priority.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatusFields
          values={values}
          onChange={onChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      </div>

      {showRecurrence ? (
        <RecurrenceFields
          values={values}
          onChange={onChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      ) : null}

      {showVisibility ? (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={values.isVisibleToCreator}
            onChange={(event) =>
              onChange("isVisibleToCreator", event.target.checked)
            }
            disabled={disabled}
            className="h-4 w-4 rounded border-slate-300"
          />
          Keep visible in my list
        </label>
      ) : null}
    </div>
  );
}
