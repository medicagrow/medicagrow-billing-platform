import { redirect } from "next/navigation";

/**
 * The Time Log became the Session Log under Analytics — the same sessions,
 * the same aggregation, with the flags and edit history alongside.
 *
 * The old query string is translated rather than dropped: this page was linked
 * to with a person and a task type already chosen, and landing on an unfiltered
 * month would quietly answer a different question from the one asked.
 */
export default function TimeLogsPage({
  searchParams,
}: {
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
  const params = new URLSearchParams();

  const join = (plural?: string, singular?: string) =>
    [...(plural ? plural.split(",") : []), ...(singular ? [singular] : [])]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(",");

  if (searchParams.from) params.set("from", searchParams.from);
  if (searchParams.to) params.set("to", searchParams.to);

  // The report's filter is `billerIds`; this page called the same thing
  // `userId`/`userIds`.
  const billerIds = join(searchParams.userIds, searchParams.userId);
  if (billerIds) params.set("billerIds", billerIds);

  const taskTypeIds = join(searchParams.taskTypeIds, searchParams.taskTypeId);
  if (taskTypeIds) params.set("taskTypeIds", taskTypeIds);

  if (searchParams.practiceIds) {
    params.set("practiceIds", searchParams.practiceIds);
  }

  const query = params.toString();

  redirect(`/analytics/session-log${query ? `?${query}` : ""}`);
}
