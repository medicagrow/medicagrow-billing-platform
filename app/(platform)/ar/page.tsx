import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  PracticesTable,
  type PracticeRow,
} from "@/components/ar/PracticesTable";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { batchStatsFor, daysBetween } from "@/lib/ar-stats";
import { BatchStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "AR Follow-Up" };
export const dynamic = "force-dynamic";

export default async function ArHomePage({
  searchParams,
}: {
  searchParams: { practiceId?: string };
}) {
  const user = await requireUser();

  // Billers have no practice-management view; send them to their queue.
  if (!canManageBatches(user)) {
    redirect("/ar/my-queue");
  }

  const practiceIds = await accessiblePracticeIds(user);

  // Global practice filter from the top bar, if one is selected.
  const selectedPracticeId =
    searchParams.practiceId &&
    (practiceIds === null || practiceIds.includes(searchParams.practiceId))
      ? searchParams.practiceId
      : undefined;

  const practices = await prisma.practice.findMany({
    where: {
      isActive: true,
      ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
      ...(selectedPracticeId ? { id: selectedPracticeId } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      ehrSource: true,
      arBatches: {
        orderBy: [{ uploadedAt: "desc" }],
        take: 1,
        select: {
          id: true,
          status: true,
          reportMonth: true,
          reportYear: true,
          totalClaims: true,
          totalBalance: true,
          uploadedAt: true,
          closedAt: true,
        },
      },
    },
  });

  const batchIds = practices
    .map((practice) => practice.arBatches[0]?.id)
    .filter((id): id is string => Boolean(id));

  /**
   * Claims, balance, completion and unassigned — all over actionable claims,
   * through the same helper the dashboard uses. This page used to count the
   * whole upload, so a batch of fresh claims read as 0% complete with a wall
   * of "unassigned" nobody was allowed to hand out.
   */
  const statsByBatch = await batchStatsFor(batchIds);

  const rows: PracticeRow[] = practices.map((practice) => {
    const batch = practice.arBatches[0];

    if (!batch) {
      return {
        id: practice.id,
        name: practice.name,
        ehrSource: practice.ehrSource,
        batchId: null,
        reportMonth: null,
        reportYear: null,
        status: null,
        totalClaims: 0,
        totalBalance: "0.00",
        percentComplete: 0,
        daysOpen: null,
        unassignedCount: 0,
        notActionableCount: 0,
      };
    }

    const stats = statsByBatch.get(batch.id);

    return {
      id: practice.id,
      name: practice.name,
      ehrSource: practice.ehrSource,
      batchId: batch.id,
      reportMonth: batch.reportMonth,
      reportYear: batch.reportYear,
      status: batch.status,
      totalClaims: stats?.totalClaims ?? 0,
      totalBalance: stats?.totalBalance ?? "0.00",
      percentComplete: stats?.percentComplete ?? 0,
      daysOpen:
        batch.status === BatchStatus.OPEN
          ? daysBetween(batch.uploadedAt, new Date())
          : null,
      // A closed batch has nothing left to hand out.
      unassignedCount:
        batch.status === BatchStatus.OPEN ? (stats?.unassignedCount ?? 0) : 0,
      notActionableCount: stats?.notActionableCount ?? 0,
    };
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Practices"
        description="Current AR batch status across every practice you manage."
      />
      <PracticesTable practices={rows} canUpload={canManageBatches(user)} />
    </div>
  );
}
