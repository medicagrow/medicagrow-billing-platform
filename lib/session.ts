import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Role } from "@/lib/generated/prisma/enums";

export function getSession() {
  return getServerSession(authOptions);
}

/**
 * Session-backed user for server components. Middleware already blocks
 * unauthenticated requests; this is the belt-and-braces check.
 */
export async function requireUser() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/login");
  }

  return session.user;
}

/**
 * For modules billers are not part of — the Tracker and To Dos.
 *
 * They go back to the dashboard rather than to a 404: the page exists, it is
 * simply not theirs, and a "not found" invites them to think something is
 * broken. The nav does not offer these modules to a biller either, so this
 * only catches a typed URL or an old bookmark.
 */
export async function requireNonBiller() {
  const user = await requireUser();

  if (user.role === Role.BILLER) {
    redirect("/");
  }

  return user;
}
