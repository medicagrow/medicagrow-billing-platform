import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ActivityDetailTable,
  type DetailRow,
} from "@/components/productivity/ActivityDetailTable";
import {
  WorkDetailTable,
  type WorkDetailRow,
} from "@/components/productivity/WorkDetailTable";
import { Button } from "@/components/ui/Button";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { Role } from "@/lib/generated/prisma/enums";
import { getActivityDetail, getBillerProductivity } from "@/lib/productivity";
import { resolveRange, toDateParam } from "@/lib/productivity/date-ranges";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Activity Detail" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ActivityDetailPage({
  params,
  searchParams,
}: {
  params: { userId: string };
  searchParams: {
    activity?: string;
    preset?: string;
    from?: string;
    to?: string;
    practiceId?: string;
    page?: string;
  };
}) {
  const user = await requireUser();

  const isManager =
    user.role === Role.OWNER || user.role === Role.PROJECT_MANAGER;

  if (!isManager && user.id !== params.userId) notFound();

  if (!searchParams.activity) notFound();

  const { from, to, preset } = resolveRange({
    preset: searchParams.preset,
    from: searchParams.from,
    to: searchParams.to,
  });

  const practiceIds = await accessiblePracticeIds(user);
  const practiceId =
    searchParams.practiceId &&
    (practiceIds === null || practiceIds.includes(searchParams.practiceId))
      ? searchParams.practiceId
      : undefined;

  const page = Math.max(1, Number(searchParams.page) || 1);

  const [productivity, detail] = await Promise.all([
    getBillerProductivity({ userId: params.userId, from, to, practiceId }),
    getActivityDetail({
      userId: params.userId,
      from,
      to,
      practiceId,
      activityKey: searchParams.activity,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  if (!productivity || !detail) notFound();

  const fromParam = toDateParam(from);
  const toParam = toDateParam(to);

  const pageHref = (nextPage: number) => {
    const query = new URLSearchParams({
      activity: searchParams.activity!,
      from: fromParam,
      to: toParam,
      page: String(nextPage),
    });
    if (preset) query.set("preset", preset);
    if (practiceId) query.set("practiceId", practiceId);
    return `/productivity/${params.userId}/detail?${query.toString()}`;
  };

  const billerHref = `/productivity/${params.userId}?from=${fromParam}&to=${toParam}${
    practiceId ? `&practiceId=${practiceId}` : ""
  }`;

  return (
    <div className="mx-auto max-w-7xl">
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        {isManager ? (
          <>
            <Link
              href="/analytics/time-productivity"
              className="hover:text-brand-700"
            >
              Time &amp; Productivity
            </Link>
            <span>/</span>
          </>
        ) : null}
        <Link href={billerHref} className="hover:text-brand-700">
          {productivity.userName}
        </Link>
        <span>/</span>
        <span className="text-slate-700">{detail.label}</span>
      </nav>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {productivity.userName} — {detail.label}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {fromParam} → {toParam} · {detail.total} record
            {detail.total === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href={billerHref}
          className="text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          ← Back to {productivity.userName}
        </Link>
      </div>

      {/* Task and To Do completions carry none of the AR columns, so they
          get their own table rather than a row of empty cells. */}
      {detail.module === "TASK" || detail.module === "TODO" ? (
        <WorkDetailTable
          rows={detail.rows as WorkDetailRow[]}
          breakdown={detail.breakdown}
          showTaskType={detail.module === "TASK"}
        />
      ) : (
        <ActivityDetailTable
          activityKey={detail.activityKey}
          label={detail.label}
          rows={detail.rows as DetailRow[]}
          billerName={productivity.userName}
          from={fromParam}
          to={toParam}
        />
      )}

      {detail.totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {detail.page} of {detail.totalPages}
          </span>
          <div className="flex gap-2">
            <Link href={pageHref(Math.max(1, detail.page - 1))}>
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                disabled={detail.page <= 1}
              >
                Previous
              </Button>
            </Link>
            <Link href={pageHref(Math.min(detail.totalPages, detail.page + 1))}>
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                disabled={detail.page >= detail.totalPages}
              >
                Next
              </Button>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
