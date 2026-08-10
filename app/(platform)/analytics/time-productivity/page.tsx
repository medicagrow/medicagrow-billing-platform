import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TimeProductivityClient } from "@/components/analytics/TimeProductivityClient";
import { analyticsFilterOptions } from "@/lib/analytics/options";
import { canManageBatches } from "@/lib/ar-access";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Time & Productivity" };
export const dynamic = "force-dynamic";

export default async function TimeProductivityPage() {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const options = await analyticsFilterOptions(user);

  return <TimeProductivityClient options={options} />;
}
