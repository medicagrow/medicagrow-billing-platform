import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { TimeLogsClient } from "@/components/productivity/TimeLogsClient";
import { canManageBatches } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { activeTaskTypes, taskPracticeOptions } from "@/lib/task-options";

export const metadata: Metadata = { title: "Time Logs" };
export const dynamic = "force-dynamic";

const list = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function TimeLogsPage({
  searchParams,
}: {
  /**
   * The productivity table links in here with a person and a task type
   * already chosen, so those arrive as query params. `userId`/`taskTypeId`
   * are the singular forms that link uses; the plural forms carry a fuller
   * selection.
   */
  searchParams: {
    userId?: string;
    userIds?: string;
    taskTypeId?: string;
    taskTypeIds?: string;
    practiceIds?: string;
    from?: string;
    to?: string;
  };
}) {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const [billers, practices, taskTypes] = await Promise.all([
    // Anyone who can run a timer can appear in the report, not just Billers —
    // PMs log time against tasks too.
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    taskPracticeOptions(user),
    activeTaskTypes(),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Time Logs & Efficiency"
        description="Logged time against estimates, per biller, practice and task type."
      />

      <TimeLogsClient
        billers={billers}
        practices={practices}
        taskTypes={taskTypes}
        initialUserIds={[
          ...list(searchParams.userIds),
          ...(searchParams.userId ? [searchParams.userId] : []),
        ]}
        initialTaskTypeIds={[
          ...list(searchParams.taskTypeIds),
          ...(searchParams.taskTypeId ? [searchParams.taskTypeId] : []),
        ]}
        initialPracticeIds={list(searchParams.practiceIds).filter((id) =>
          practices.some((practice) => practice.id === id),
        )}
        initialFrom={
          searchParams.from && ISO_DATE.test(searchParams.from)
            ? searchParams.from
            : undefined
        }
        initialTo={
          searchParams.to && ISO_DATE.test(searchParams.to)
            ? searchParams.to
            : undefined
        }
      />
    </div>
  );
}
