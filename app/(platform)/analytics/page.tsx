import { redirect } from "next/navigation";

/** Analytics has no landing page of its own; the first report is the door. */
export default function AnalyticsIndex() {
  redirect("/analytics/time-productivity");
}
