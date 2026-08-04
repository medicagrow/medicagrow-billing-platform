import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { TrackerTable, type TrackerRow } from "@/components/tracker/TrackerTable";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { requireNonBiller } from "@/lib/session";
import { monthYearToDate } from "@/lib/validations/tracker";

export const metadata: Metadata = { title: "Tracker" };
export const dynamic = "force-dynamic";

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function TrackerHomePage({
  searchParams,
}: {
  searchParams: { monthYear?: string; practiceId?: string };
}) {
  const user = await requireNonBiller();

  if (!canManageBatches(user)) notFound();

  const monthYear = /^\d{4}-\d{2}$/.test(searchParams.monthYear ?? "")
    ? searchParams.monthYear!
    : currentMonth();

  const practiceIds = await accessiblePracticeIds(user);

  const selectedPracticeId =
    searchParams.practiceId &&
    (practiceIds === null || practiceIds.includes(searchParams.practiceId))
      ? searchParams.practiceId
      : undefined;

  const [practices, entries] = await Promise.all([
    prisma.practice.findMany({
      where: {
        isActive: true,
        ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
        ...(selectedPracticeId ? { id: selectedPracticeId } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.trackerEntry.findMany({
      where: { monthYear: monthYearToDate(monthYear) },
      select: {
        id: true,
        practiceId: true,
        scoreA: true,
        scoreB: true,
        scoreC: true,
        scoreD: true,
        scoreE: true,
        scoreF: true,
        scoreG: true,
        scoreH: true,
        finalScore: true,
        lockStatus: true,
      },
    }),
  ]);

  // Every accessible practice gets a row, even without an entry — an absent
  // month is exactly what a PM needs to see.
  const rows: TrackerRow[] = practices.map((practice) => {
    const entry = entries.find((row) => row.practiceId === practice.id);

    return {
      practiceId: practice.id,
      practiceName: practice.name,
      entryId: entry?.id ?? null,
      scoreA: entry?.scoreA ?? null,
      scoreB: entry?.scoreB ?? null,
      scoreC: entry?.scoreC ?? null,
      scoreD: entry?.scoreD ?? null,
      scoreE: entry?.scoreE ?? null,
      scoreF: entry?.scoreF ?? null,
      scoreG: entry?.scoreG ?? null,
      scoreH: entry?.scoreH ?? null,
      finalScore: entry?.finalScore ? Number(entry.finalScore) : null,
      lockStatus: entry?.lockStatus ?? null,
    };
  });

  const scored = rows.filter((row) => row.finalScore !== null);
  const average =
    scored.length === 0
      ? null
      : Math.round(
          (scored.reduce((sum, row) => sum + (row.finalScore ?? 0), 0) /
            scored.length) *
            10,
        ) / 10;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Practice Health Tracker"
        description={
          average === null
            ? "Monthly scoring across every practice."
            : `Monthly scoring across every practice · average ${average} this month`
        }
      />
      <TrackerTable rows={rows} monthYear={monthYear} />
    </div>
  );
}
