import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/**
 * GET /api/ar/users — assignable users for the PM's assignment dropdowns.
 * Optionally scoped to the practice a batch belongs to.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const practiceId = request.nextUrl.searchParams.get("practiceId") ?? undefined;

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: [Role.BILLER, Role.PROJECT_MANAGER, Role.OWNER] },
      ...(practiceId ? { practices: { some: { practiceId } } } : {}),
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true },
  });

  return NextResponse.json({ data: users });
}
