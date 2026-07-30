import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  PracticesTable,
  type PracticeRow,
} from "@/components/ar/PracticesTable";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { daysBetween } from "@/lib/ar-stats";
import {
  BatchStatus,
  StatusCategory,
} from "@/lib/generated/prisma/enums";
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

  const [greenCounts, unassignedCounts] = await Promise.all([
    prisma.arClaim.groupBy({
      by: ["batchId"],
      where: {
        batchId: { in: batchIds },
        statusCategory: StatusCategory.GREEN,
      },
      _count: { _all: true },
    }),
    prisma.arClaim.groupBy({
      by: ["batchId"],
      where: { batchId: { in: batchIds }, assignedToId: null },
      _count: { _all: true },
    }),
  ]);

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
      };
    }

    const green =
      greenCounts.find((row) => row.batchId === batch.id)?._count._all ?? 0;

    return {
      id: practice.id,
      name: practice.name,
      ehrSource: practice.ehrSource,
      batchId: batch.id,
      reportMonth: batch.reportMonth,
      reportYear: batch.reportYear,
      status: batch.status,
      totalClaims: batch.totalClaims,
      totalBalance: batch.totalBalance.toString(),
      percentComplete:
        batch.totalClaims === 0
          ? 0
          : Math.round((green / batch.totalClaims) * 100),
      daysOpen:
        batch.status === BatchStatus.OPEN
          ? daysBetween(batch.uploadedAt, new Date())
          : null,
      unassignedCount:
        batch.status === BatchStatus.OPEN
          ? (unassignedCounts.find((row) => row.batchId === batch.id)?._count
              ._all ?? 0)
          : 0,
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
