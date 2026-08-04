import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { arSummary } from "@/lib/ar-summary";
import { formatUSD } from "@/lib/format";
import { moduleItems } from "@/lib/navigation";
import { roleBadgeVariants, roleLabels } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import {
  StatusCategory,
  TaskStatus,
  TodoStatus,
} from "@/lib/generated/prisma/enums";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { generateDueInstances } from "@/lib/task/recurrence";
import { dayEnd, dayStart } from "@/lib/todo/access";
import { checkHoldReleases } from "@/lib/todo/hold-release";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const PRACTICE_ROWS = 5;

/** One figure on a module card, with where its number leads. */
interface ModuleStat {
  label: string;
  value: string;
  tone?: "red" | "amber";
  href?: string;
}

/**
 * One figure on the dashboard.
 *
 * A number on a dashboard is a question — "which claims are those?" — so where
 * an answer exists the figure links to the list that holds it. Cards with no
 * meaningful destination stay plain rather than linking somewhere approximate.
 */
function Stat({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: string;
  tone?: "red" | "amber";
  href?: string;
}) {
  const toneClass =
    tone === "red"
      ? "text-red-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-slate-900";

  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-100">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      {href ? (
        <Link
          href={href}
          className={`mt-0.5 block text-xl font-semibold tabular-nums underline-offset-4 hover:underline ${toneClass}`}
        >
          {value}
        </Link>
      ) : (
        <p className={`mt-0.5 text-xl font-semibold tabular-nums ${toneClass}`}>
          {value}
        </p>
      )}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { practiceId?: string };
}) {
  const user = await requireUser();

  const practiceIds = await accessiblePracticeIds(user);

  // Honour the global practice selector, ignoring an out-of-scope id.
  const selectedPracticeId =
    searchParams.practiceId &&
    (practiceIds === null || practiceIds.includes(searchParams.practiceId))
      ? searchParams.practiceId
      : undefined;

  const summary = await arSummary({ practiceIds, selectedPracticeId });
  const isManager = canManageBatches(user);

  const practiceFilter = selectedPracticeId
    ? { practiceId: selectedPracticeId }
    : practiceIds === null
      ? {}
      : { practiceId: { in: practiceIds } };

  // The dashboard is often the first page of the day, so held work that is
  // due back must be released — and any recurring occurrence that came due
  // must be created — before any of these counts are taken.
  await Promise.all([checkHoldReleases(user.id), generateDueInstances()]);

  const today = dayStart();
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );

  const [
    eobUnresolved,
    trackerEntries,
    todosDueToday,
    todosOverdue,
    tasksOpen,
    tasksOverdue,
  ] = await Promise.all([
      prisma.eobEntry.findMany({
        where: {
          batch: practiceFilter,
          statusCategory: { not: StatusCategory.GREEN },
        },
        select: { deniedAmount: true },
      }),
      prisma.trackerEntry.findMany({
        where: {
          monthYear: monthStart,
          finalScore: { not: null },
          ...(selectedPracticeId
            ? { practiceId: selectedPracticeId }
            : practiceIds === null
              ? {}
              : { practiceId: { in: practiceIds } }),
        },
        select: { finalScore: true },
      }),
      prisma.todo.count({
        where: {
          assignedToId: user.id,
          dueDate: { gte: today, lte: dayEnd(today) },
          status: { in: [TodoStatus.OPEN, TodoStatus.IN_PROCESS] },
        },
      }),
      prisma.todo.count({
        where: {
          assignedToId: user.id,
          dueDate: { lt: today },
          status: { in: [TodoStatus.OPEN, TodoStatus.IN_PROCESS] },
        },
      }),
      prisma.task.count({
        where: {
          assignedToId: user.id,
          status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROCESS] },
        },
      }),
      prisma.task.count({
        where: {
          assignedToId: user.id,
          dueDate: { lt: today },
          status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROCESS] },
        },
      }),
    ]);

  let atRiskCents = 0n;
  for (const entry of eobUnresolved) {
    atRiskCents += toCents(entry.deniedAmount?.toString() ?? "0");
  }

  const averageHealth =
    trackerEntries.length === 0
      ? null
      : Math.round(
          (trackerEntries.reduce(
            (sum, entry) => sum + Number(entry.finalScore ?? 0),
            0,
          ) /
            trackerEntries.length) *
            10,
        ) / 10;

  // Module cards follow the same role rules the sidebar does — a biller has
  // no Tracker or To Do, so they should not be offered one here either.
  const visibleModules = moduleItems.filter(
    (module) => !module.roles || module.roles.includes(user.role),
  );

  const arModule = visibleModules.find((module) => module.href === "/ar");
  const otherModules = visibleModules.filter(
    (module) => module.href !== "/ar",
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Welcome, {user.name ?? "there"}
          </h2>
          <Badge variant={roleBadgeVariants[user.role]}>
            {roleLabels[user.role]}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Your work across the platform. Modules populate as they come online.
        </p>
      </div>

      {/* ------------------------- AR Follow-Up ------------------------- */}
      <Card className="mb-5">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              AR Follow-Up
              {summary.openBatchCount > 0 ? (
                <Badge variant="brand">
                  {summary.openBatchCount} open batch
                  {summary.openBatchCount === 1 ? "" : "es"}
                </Badge>
              ) : null}
            </span>
          }
          description={
            arModule?.description ??
            "Work aged claims, track denials and follow-up outcomes."
          }
          icon={arModule ? <arModule.icon className="h-5 w-5" /> : undefined}
          action={
            <Link
              href={isManager ? "/ar/dashboard" : "/ar/my-queue"}
              className="whitespace-nowrap text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              {isManager ? "View AR Dashboard" : "View My Queue"} →
            </Link>
          }
        />
        <CardBody>
          {summary.openBatchCount === 0 ? (
            <EmptyState
              title="No open AR batches"
              description={
                isManager
                  ? "Upload a batch from the Practices page to start tracking claims."
                  : "Nothing is currently assigned to you."
              }
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Open batches"
                  value={String(summary.openBatchCount)}
                />
                <Stat
                  label="Outstanding balance"
                  value={formatUSD(summary.totalBalance)}
                  href="/ar/dashboard"
                />
                <Stat
                  label="Red claims"
                  value={String(summary.totalRedClaims)}
                  href="/ar/my-queue"
                />
                <Stat
                  label="Overdue follow-ups"
                  value={String(summary.overdueCount)}
                  tone={summary.overdueCount > 0 ? "red" : undefined}
                  href="/ar/my-queue?overdue=true"
                />
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-600">
                    Overall progress
                  </span>
                  <span className="tabular-nums text-slate-500">
                    {summary.totalGreenClaims} of {summary.totalClaims} claims (
                    {summary.percentComplete}%)
                  </span>
                </div>
                <ProgressBar percent={summary.percentComplete} />
              </div>

              {summary.practices.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-lg ring-1 ring-slate-200">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Practice</th>
                        <th className="px-3 py-2">Batch</th>
                        <th className="px-3 py-2 text-right">Complete</th>
                        <th className="px-3 py-2 text-right">Days open</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {summary.practices
                        .slice(0, PRACTICE_ROWS)
                        .map((practice) => (
                          <tr key={practice.batchId} className="hover:bg-slate-50">
                            <td className="px-3 py-2">
                              <Link
                                href={`/ar/batches/${practice.batchId}`}
                                className="font-medium text-slate-900 hover:text-brand-700"
                              >
                                {practice.practiceName}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {MONTH_NAMES[practice.reportMonth - 1]}{" "}
                              {practice.reportYear}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-2">
                                <ProgressBar
                                  percent={practice.percentComplete}
                                  className="w-20"
                                />
                                <span className="w-9 text-right tabular-nums text-slate-700">
                                  {practice.percentComplete}%
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <span
                                className={
                                  practice.daysOpen > 60
                                    ? "font-medium text-amber-700"
                                    : "text-slate-700"
                                }
                              >
                                {practice.daysOpen}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>

                  {summary.practices.length > PRACTICE_ROWS ? (
                    <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                      Showing {PRACTICE_ROWS} of {summary.practices.length}{" "}
                      practices with open batches.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>

      {/* --------------------------- Other modules --------------------------- */}
      <div className="grid gap-5 sm:grid-cols-2">
        {otherModules.map((module) => {
          const IconComponent = module.icon;

          const live: { href: string; stats: ModuleStat[] } | null =
            module.href === "/eob"
              ? {
                  href: "/eob",
                  stats: [
                    {
                      label: "Unresolved",
                      value: String(eobUnresolved.length),
                      tone: eobUnresolved.length > 0 ? ("red" as const) : undefined,
                      href: "/eob?statusCategory=RED",
                    },
                    {
                      label: "Amount at risk",
                      value: formatUSD(centsToDecimalString(atRiskCents)),
                    },
                  ],
                }
              : module.href === "/tracker"
                ? {
                    href: "/tracker",
                    stats: [
                      {
                        label: "Average health score",
                        value: averageHealth === null ? "—" : String(averageHealth),
                        href: "/tracker",
                      },
                      {
                        label: "Practices scored",
                        value: String(trackerEntries.length),
                      },
                    ],
                  }
                : module.href === "/tasks"
                  ? {
                      href: "/tasks",
                      stats: [
                        {
                          label: "Open",
                          value: String(tasksOpen),
                          href: "/tasks",
                        },
                        {
                          label: "Overdue",
                          value: String(tasksOverdue),
                          tone: tasksOverdue > 0 ? ("red" as const) : undefined,
                          href: "/tasks/list?overdue=true",
                        },
                      ],
                    }
                  : module.href === "/todos"
                  ? {
                      href: "/todos",
                      stats: [
                        {
                          label: "Due today",
                          value: String(todosDueToday),
                          href: "/todos/list?dueToday=true",
                        },
                        {
                          label: "Overdue",
                          value: String(todosOverdue),
                          tone: todosOverdue > 0 ? ("red" as const) : undefined,
                          href: "/todos/list?overdue=true",
                        },
                      ],
                    }
                  : null;

          return (
            <Card key={module.href}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {module.label}
                    {module.comingSoon ? (
                      <Badge variant={module.accent}>Coming Soon</Badge>
                    ) : null}
                  </span>
                }
                description={module.description}
                icon={<IconComponent className="h-5 w-5" />}
                action={
                  live ? (
                    <Link
                      href={live.href}
                      className="whitespace-nowrap text-sm font-medium text-brand-700 hover:text-brand-800"
                    >
                      Open →
                    </Link>
                  ) : undefined
                }
              />
              <CardBody>
                {live ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {live.stats.map((stat) => (
                      <Stat
                        key={stat.label}
                        label={stat.label}
                        value={stat.value}
                        tone={stat.tone}
                        href={stat.href}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Not available yet"
                    description="This module is planned for a future release."
                  />
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
