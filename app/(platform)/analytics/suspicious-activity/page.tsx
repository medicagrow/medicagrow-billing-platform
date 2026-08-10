import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SuspiciousActivityClient } from "@/components/analytics/SuspiciousActivityClient";
import { analyticsFilterOptions } from "@/lib/analytics/options";
import { canManageBatches } from "@/lib/ar-access";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Suspicious Activity" };
export const dynamic = "force-dynamic";

export default async function SuspiciousActivityPage() {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const options = await analyticsFilterOptions(user);

  return (
    <SuspiciousActivityClient options={options} currentUserId={user.id} />
  );
}
