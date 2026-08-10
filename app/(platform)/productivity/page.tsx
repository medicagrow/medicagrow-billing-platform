import { redirect } from "next/navigation";

/**
 * Team Productivity became the Time & Productivity report under Analytics,
 * which answers the same question from the same numbers and adds the practice
 * and task-type breakdowns this page could not show.
 *
 * The route stays as a redirect rather than being deleted: it is bookmarked and
 * linked from elsewhere, and a 404 would teach people the report is gone rather
 * than moved. The dates come with it — the report opens on this month by
 * default, and silently widening someone's chosen week to that would be wrong.
 */
export default function ProductivityPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; practiceIds?: string };
}) {
  const params = new URLSearchParams();

  if (searchParams.from) params.set("from", searchParams.from);
  if (searchParams.to) params.set("to", searchParams.to);
  if (searchParams.practiceIds) {
    params.set("practiceIds", searchParams.practiceIds);
  }

  // Dates carried over are a range somebody picked, so the period follows.
  if (searchParams.from && searchParams.to) params.set("period", "custom");

  const query = params.toString();

  redirect(`/analytics/time-productivity${query ? `?${query}` : ""}`);
}
