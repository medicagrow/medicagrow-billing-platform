import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { upsertRequirementSchema } from "@/lib/validations/requirements";

/** A PM may only reach the practices they are on; an Owner reaches all. */
async function denyOutOfScope(
  user: { id: string; role: Role },
  practiceId: string,
) {
  const accessible = await accessiblePracticeIds(user);

  if (accessible !== null && !accessible.includes(practiceId)) {
    return apiErrorResponse("Practice not found.", 404);
  }

  return null;
}

/** GET — the monthly requirements this practice has set. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { practiceId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const outOfScope = await denyOutOfScope(session!.user, params.practiceId);
  if (outOfScope) return outOfScope;

  const requirements = await prisma.practiceRequirement.findMany({
    where: { practiceId: params.practiceId },
    include: { taskType: { select: { id: true, name: true, isActive: true } } },
    orderBy: [{ taskType: { sortOrder: "asc" } }, { taskType: { name: "asc" } }],
  });

  return NextResponse.json({
    data: requirements.map((requirement) => ({
      id: requirement.id,
      taskTypeId: requirement.taskTypeId,
      taskTypeName: requirement.taskType.name,
      taskTypeIsActive: requirement.taskType.isActive,
      monthlyHours: requirement.monthlyHours.toString(),
      notes: requirement.notes,
      updatedAt: requirement.updatedAt.toISOString(),
    })),
  });
}

/**
 * POST — set one task type's requirement.
 *
 * An upsert on (practice, task type): the table holds one number per pair, so
 * saving the same row twice corrects it rather than adding a second.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { practiceId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const outOfScope = await denyOutOfScope(session!.user, params.practiceId);
  if (outOfScope) return outOfScope;

  const body = upsertRequirementSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  const [practice, taskType] = await Promise.all([
    prisma.practice.findUnique({
      where: { id: params.practiceId },
      select: { id: true },
    }),
    prisma.taskType.findUnique({
      where: { id: input.taskTypeId },
      select: { id: true },
    }),
  ]);

  if (!practice) return apiErrorResponse("Practice not found.", 404);
  if (!taskType) return apiErrorResponse("Task type not found.", 422);

  const requirement = await prisma.practiceRequirement.upsert({
    where: {
      practiceId_taskTypeId: {
        practiceId: params.practiceId,
        taskTypeId: input.taskTypeId,
      },
    },
    create: {
      practiceId: params.practiceId,
      taskTypeId: input.taskTypeId,
      monthlyHours: input.monthlyHours,
      notes: input.notes ?? null,
      createdById: session!.user.id,
    },
    update: {
      monthlyHours: input.monthlyHours,
      notes: input.notes ?? null,
      updatedById: session!.user.id,
    },
  });

  return NextResponse.json({
    requirement: {
      id: requirement.id,
      taskTypeId: requirement.taskTypeId,
      monthlyHours: requirement.monthlyHours.toString(),
      notes: requirement.notes,
    },
  });
}
