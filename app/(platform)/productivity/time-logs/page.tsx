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

export default async function TimeLogsPage() {
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
      />
    </div>
  );
}
