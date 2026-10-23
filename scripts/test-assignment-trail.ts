/**
 * The claim assignment trail (decision alongside 01 P1-01).
 *
 *   npx tsx scripts/test-assignment-trail.ts
 *
 * `assignedToId` says who holds a claim now; the trail says how it got there.
 * Both assign routes write it, so this exercises the shared recorder the way
 * they call it — including the case that matters most, a claim moving from one
 * person to another, which is what nobody could reconstruct before.
 *
 * Creates ZZ-prefixed rows and removes them at the end. Pipe to `tail`.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { PrismaClient } from "../lib/generated/prisma/client";
import {
  ArAssignmentSource,
  BatchStatus,
  EhrSource,
  Role,
} from "../lib/generated/prisma/enums";

config({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const STAMP = Date.now();

async function main() {
  const { recordAssignments } = await import("../lib/ar/assignment-trail");

  const owner = await prisma.user.findFirst({
    where: { role: Role.OWNER, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("no owner user to hang the fixtures on");

  const [first, second] = await Promise.all(
    ["First", "Second"].map((suffix) =>
      prisma.user.create({
        data: {
          name: `ZZ Trail ${suffix}`,
          email: `zz-trail-${suffix.toLowerCase()}-${STAMP}@example.test`,
          hashedPassword: "not-a-real-hash",
          role: Role.BILLER,
        },
      }),
    ),
  );

  const practice = await prisma.practice.create({
    data: { name: `ZZ Trail Practice ${STAMP}`, ehrSource: EhrSource.OPEN_PM },
  });

  const batch = await prisma.arBatch.create({
    data: {
      practiceId: practice.id,
      ehrSource: EhrSource.OPEN_PM,
      reportMonth: 10,
      reportYear: 2026,
      status: BatchStatus.OPEN,
      uploadedById: owner.id,
      totalClaims: 0,
      totalBalance: "0.00",
    },
  });

  const makeClaim = (name: string) =>
    prisma.arClaim.create({
      data: {
        batchId: batch.id,
        patientName: `ZZ ${name}`,
        insuranceName: "ZZ Insurance",
        dateOfService: new Date("2026-05-05T00:00:00.000Z"),
        balance: "100.00",
        agingDays: 60,
        statusLabel: "Need to Call",
        statusCategory: "RED",
      },
    });

  try {
    const claims = await Promise.all([
      makeClaim("one"),
      makeClaim("two"),
      makeClaim("three"),
    ]);

    console.log("=== first assignment, from nobody ===");

    await recordAssignments({
      changes: claims.map((claim) => ({ claimId: claim.id, fromUserId: null })),
      toUserId: first!.id,
      assignedById: owner.id,
      source: ArAssignmentSource.BULK,
    });

    const afterFirst = await prisma.arClaimAssignment.findMany({
      where: { claimId: { in: claims.map((claim) => claim.id) } },
    });

    check("a row per claim", afterFirst.length === 3);
    check(
      "it records who did it and how",
      afterFirst.every(
        (row) =>
          row.assignedById === owner.id &&
          row.source === ArAssignmentSource.BULK,
      ),
    );
    check(
      "'from' is null when the claim was unassigned",
      afterFirst.every((row) => row.fromUserId === null),
    );
    check(
      "'to' names the new holder",
      afterFirst.every((row) => row.toUserId === first!.id),
    );

    console.log("\n=== the hand-over nobody could reconstruct ===");

    await recordAssignments({
      changes: [{ claimId: claims[0]!.id, fromUserId: first!.id }],
      toUserId: second!.id,
      assignedById: owner.id,
      source: ArAssignmentSource.SINGLE,
    });

    const handOver = await prisma.arClaimAssignment.findFirst({
      where: { claimId: claims[0]!.id, source: ArAssignmentSource.SINGLE },
    });

    check(
      "the move records both ends",
      handOver?.fromUserId === first!.id && handOver?.toUserId === second!.id,
    );

    const history = await prisma.arClaimAssignment.findMany({
      where: { claimId: claims[0]!.id },
      orderBy: { assignedAt: "asc" },
    });

    check("the claim keeps both steps", history.length === 2, "add-only");

    console.log("\n=== unassigning, and non-events ===");

    await recordAssignments({
      changes: [{ claimId: claims[1]!.id, fromUserId: first!.id }],
      toUserId: null,
      assignedById: owner.id,
      source: ArAssignmentSource.SINGLE,
    });

    const takenBack = await prisma.arClaimAssignment.findFirst({
      where: { claimId: claims[1]!.id, toUserId: null },
    });
    check("taking work back is recorded, with a null 'to'", Boolean(takenBack));

    const written = await recordAssignments({
      changes: [{ claimId: claims[2]!.id, fromUserId: first!.id }],
      toUserId: first!.id,
      assignedById: owner.id,
      source: ArAssignmentSource.BULK,
    });

    check(
      "re-assigning to the current holder writes nothing",
      written === 0,
      "a trail full of non-events is one nobody reads",
    );

    const total = await prisma.arClaimAssignment.count({
      where: { claimId: { in: claims.map((claim) => claim.id) } },
    });
    // Three first assignments, one hand-over, one unassign — and nothing
    // for the no-op.
    check("five events in all", total === 5, String(total));

    console.log("\n=== the question this exists to answer ===");

    const whoGaveItTo = await prisma.arClaimAssignment.findFirst({
      where: { claimId: claims[0]!.id, toUserId: second!.id },
      orderBy: { assignedAt: "desc" },
      select: {
        assignedBy: { select: { name: true } },
        fromUser: { select: { name: true } },
        assignedAt: true,
      },
    });

    check(
      "'who put this claim in my queue, and when' is answerable",
      whoGaveItTo?.assignedBy.name === owner.name &&
        whoGaveItTo?.fromUser?.name === "ZZ Trail First" &&
        whoGaveItTo?.assignedAt instanceof Date,
      `${whoGaveItTo?.assignedBy.name} moved it from ${whoGaveItTo?.fromUser?.name}`,
    );
  } finally {
    // Assignments cascade from the claims, which cascade from the batch.
    await prisma.arBatch.delete({ where: { id: batch.id } });
    await prisma.practice.delete({ where: { id: practice.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [first!.id, second!.id] } },
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
