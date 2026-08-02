import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { AssignTaskButton } from "@/components/task/AssignTaskButton";
import { TeamTasksClient } from "@/components/task/TeamTasksClient";
import { TimeEditRequestsPanel } from "@/components/task/TimeEditRequestsPanel";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { Role, TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  activeTaskTypes,
  assignableUsersFor,
  taskPracticeOptions,
} from "@/lib/task-options";
import { dayStart } from "@/lib/todo/access";

export const metadata: Metadata = { title: "Team Tasks" };
export const dynamic = "force-dynamic";

export default async function TeamTasksPage({
  searchParams,
}: {
  searchParams: { practiceId?: string; practiceIds?: string };
}) {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const practiceIds = await accessiblePracticeIds(user);

  // practiceIds is the multi-select; practiceId is kept so older links and
  // bookmarks still land somewhere sensible.
  const requested = [
    ...(searchParams.practiceIds?.split(",") ?? []),
    ...(searchParams.practiceId ? [searchParams.practiceId] : []),
  ]
    .map((id) => id.trim())
    .filter((id) => id !== "");

  const selectedPracticeIds = Array.from(
    new Set(
      requested.filter(
        (id) => practiceIds === null || practiceIds.includes(id),
      ),
    ),
  );

  const [practices, assignableUsers, taskTypes, members] = await Promise.all([
    taskPracticeOptions(user),
    assignableUsersFor(user),
    activeTaskTypes(),
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [Role.BILLER, Role.PROJECT_MANAGER, Role.OWNER] },
        ...(practiceIds === null
          ? {}
          : { practices: { some: { practiceId: { in: practiceIds } } } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  const today = dayStart();

  const practiceFilter =
    selectedPracticeIds.length > 0
      ? { practiceId: { in: selectedPracticeIds } }
      : {};

  const stats = await Promise.all(
    members.map(async (member) => {
      const base = { assignedToId: member.id, ...practiceFilter };

      const [open, inProcess, hold, overdue, closed] = await Promise.all([
        prisma.task.count({ where: { ...base, status: TaskStatus.OPEN } }),
        prisma.task.count({ where: { ...base, status: TaskStatus.IN_PROCESS } }),
        prisma.task.count({ where: { ...base, status: TaskStatus.HOLD } }),
        prisma.task.count({
          where: {
            ...base,
            dueDate: { lt: today },
            // Matches GET /api/tasks?overdue=true, so the count and the link
            // it points at cannot disagree.
            status: {
              in: [TaskStatus.OPEN, TaskStatus.IN_PROCESS, TaskStatus.HOLD],
            },
          },
        }),
        prisma.task.count({ where: { ...base, status: TaskStatus.CLOSED } }),
      ]);

      return { ...member, open, inProcess, hold, overdue, closed };
    }),
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Team Tasks"
        description="Workload across the team, by status."
        action={
          <AssignTaskButton
            practices={practices}
            assignableUsers={assignableUsers}
            taskTypes={taskTypes}
            currentUserId={user.id}
          />
        }
      />

      <TeamTasksClient
        members={stats}
        practices={practices}
        selectedPracticeIds={selectedPracticeIds}
      />

      <div className="mt-6">
        <TimeEditRequestsPanel />
      </div>
    </div>
  );
}
