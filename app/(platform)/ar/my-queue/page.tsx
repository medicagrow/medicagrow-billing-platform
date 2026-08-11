import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { MyQueueClient } from "@/components/ar/MyQueueClient";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { BatchStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "My Queue" };
export const dynamic = "force-dynamic";

export default async function MyQueuePage() {
  const user = await requireUser();

  const practiceIds = await accessiblePracticeIds(user);

  /**
   * Filter options come from this person's own book — everything assigned to
   * them in an open batch, across every tab. Deliberately wider than the
   * current view: a dropdown whose options change as you filter is a dropdown
   * you cannot use to undo a filter.
   */
  const ownClaims = {
    assignedToId: user.id,
    batch: {
      status: BatchStatus.OPEN,
      ...(practiceIds === null ? {} : { practiceId: { in: practiceIds } }),
    },
  };

  const [practices, insurances, visitStatuses] = await Promise.all([
    prisma.practice.findMany({
      where: {
        isActive: true,
        ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.arClaim.findMany({
      where: ownClaims,
      distinct: ["insuranceName"],
      select: { insuranceName: true },
      orderBy: { insuranceName: "asc" },
    }),
    prisma.arClaim.findMany({
      where: { ...ownClaims, visitStatus: { not: null } },
      distinct: ["visitStatus"],
      select: { visitStatus: true },
      orderBy: { visitStatus: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="My Queue"
        description="Every red claim assigned to you, oldest and most overdue first."
      />
      <MyQueueClient
        practices={practices}
        insuranceOptions={insurances.map((row) => row.insuranceName)}
        visitStatusOptions={visitStatuses
          .map((row) => row.visitStatus?.trim())
          .filter((status): status is string => Boolean(status))}
        isManager={canManageBatches(user)}
      />
    </div>
  );
}
