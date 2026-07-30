import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

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
