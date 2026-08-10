import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SessionLogClient } from "@/components/analytics/SessionLogClient";
import { analyticsFilterOptions } from "@/lib/analytics/options";
import { canManageBatches } from "@/lib/ar-access";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Session Log" };
export const dynamic = "force-dynamic";

export default async function SessionLogPage() {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const options = await analyticsFilterOptions(user);

  return <SessionLogClient options={options} />;
}
