/**
 * The 0–30 day rule, and "reassigned to me" detection.
 *
 *   npx tsx scripts/test-actionable.ts
 *
 * Two rules that are easy to get subtly wrong and hard to spot in the UI:
 *
 *  - a claim aged 30 days or less is **visible but not workable**, so it is
 *    out of the queue, out of assignment and out of every completion rate,
 *    while still counting towards the batch's headline totals;
 *  - a claim was *handed* to somebody only if the **latest** note that moved
 *    it named them — an earlier one that has since been superseded does not.
 *
 * Creates ZZ-prefixed rows and removes them at the end. It never touches real
 * data.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import {
  BatchStatus,
  EhrSource,
  OutcomeType,
  Role,
  StatusCategory,
} from "../lib/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

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
  // These modules import lib/prisma, which reads DATABASE_URL as it loads.
  const {
    isNotActionable,
    NOT_ACTIONABLE_MAX_DAYS,
    ACTIONABLE_WHERE,
    NOT_ACTIONABLE_WHERE,
  } = await import("../lib/ar-actionable");
  const { batchStats } = await import("../lib/ar-stats");
  const { agingBadgeClasses } = await import("../lib/ar-aging");
  const { manuallyReassignedTo, countReassignedToMe } = await import(
    "../lib/ar-reassignment"
  );

  console.log("=== the boundary ===");

  check("0 days is not actionable", isNotActionable({ agingDays: 0 }));
  check("29 days is not actionable", isNotActionable({ agingDays: 29 }));
  check(
    "exactly 30 days is not actionable — the bucket is inclusive",
    isNotActionable({ agingDays: NOT_ACTIONABLE_MAX_DAYS }),
  );
  check(
    "31 days is actionable",
    !isNotActionable({ agingDays: NOT_ACTIONABLE_MAX_DAYS + 1 }),
  );
  check("400 days is actionable", !isNotActionable({ agingDays: 400 }));

  check(
    "the two where fragments are complements at the boundary",
    ACTIONABLE_WHERE.agingDays.gt === NOT_ACTIONABLE_MAX_DAYS &&
      NOT_ACTIONABLE_WHERE.agingDays.lte === NOT_ACTIONABLE_MAX_DAYS,
  );

  console.log("\n=== the badge does not read as healthy ===");

  check(
    "a fresh claim is grey, not green",
    agingBadgeClasses(10).includes("slate") &&
      !agingBadgeClasses(10).includes("emerald"),
    agingBadgeClasses(10),
  );
  check("45 days is amber", agingBadgeClasses(45).includes("amber"));
  check("120 days is red", agingBadgeClasses(120).includes("red"));

  // ---------------------------------------------------------------- fixtures

  const owner = await prisma.user.findFirst({
    where: { role: Role.OWNER, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("no owner user to hang the fixtures on");

  const pm = await prisma.user.create({
    data: {
      name: "ZZ Actionable PM",
      email: `zz-actionable-pm-${STAMP}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.PROJECT_MANAGER,
    },
  });

  const biller = await prisma.user.create({
    data: {
      name: "ZZ Actionable Biller",
      email: `zz-actionable-biller-${STAMP}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.BILLER,
    },
  });

  const otherBiller = await prisma.user.create({
    data: {
      name: "ZZ Actionable Other",
      email: `zz-actionable-other-${STAMP}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.BILLER,
    },
  });

  const practice = await prisma.practice.create({
    data: {
      name: `ZZ Actionable Practice ${STAMP}`,
      ehrSource: EhrSource.OPEN_PM,
      primaryPmId: pm.id,
    },
  });

  const batch = await prisma.arBatch.create({
    data: {
      practiceId: practice.id,
      ehrSource: EhrSource.OPEN_PM,
      reportMonth: 1,
      reportYear: 2026,
      status: BatchStatus.OPEN,
      uploadedById: owner.id,
      totalClaims: 0,
      totalBalance: "0.00",
    },
  });

  const makeClaim = (
    label: string,
    agingDays: number,
    statusCategory: StatusCategory,
    assignedToId: string | null,
  ) =>
    prisma.arClaim.create({
      data: {
        batchId: batch.id,
        patientName: `ZZ ${label}`,
        insuranceName: "ZZ Insurance",
        dateOfService: new Date("2026-01-05T00:00:00.000Z"),
        balance: "100.00",
        agingDays,
        statusCategory,
        statusLabel:
          statusCategory === StatusCategory.GREEN ? "Paid" : "Pending",
        assignedToId,
      },
    });

  /**
   * Five fresh claims and four aged ones, chosen so that **every** percentage
   * differs between the two denominators. A fixture where 2-of-8 and 1-of-4
   * both come to 25% would pass whether or not the rule was applied.
   */
  const [freshGreen, freshGreen2, freshRed, freshRed2, freshUnassigned] =
    await Promise.all([
      makeClaim("fresh green", 10, StatusCategory.GREEN, biller.id),
      makeClaim("fresh green two", 15, StatusCategory.GREEN, biller.id),
      makeClaim("fresh red", 20, StatusCategory.RED, biller.id),
      makeClaim("fresh red boundary", 30, StatusCategory.RED, biller.id),
      makeClaim("fresh unassigned", 5, StatusCategory.RED, null),
    ]);

  const [agedGreen, agedRed, agedBlue, agedUnassigned] = await Promise.all([
    makeClaim("aged green", 60, StatusCategory.GREEN, biller.id),
    makeClaim("aged red", 90, StatusCategory.RED, biller.id),
    makeClaim("aged blue", 120, StatusCategory.BLUE, pm.id),
    makeClaim("aged unassigned", 45, StatusCategory.RED, null),
  ]);

  console.log("\n=== batch stats ===");

  const stats = await batchStats(batch.id);

  check("every claim counts towards the total", stats.totalClaims === 9, String(stats.totalClaims));
  check(
    "five of them are not yet actionable",
    stats.notActionableCount === 5,
    String(stats.notActionableCount),
  );
  check(
    "four remain in the completion denominator",
    stats.actionableClaims === 4,
    String(stats.actionableClaims),
  );

  check(
    "the green count is the whole batch, not the workable part",
    stats.greenCount === 3,
    `${stats.greenCount} — the close dialog must still see fresh unworked claims`,
  );

  check(
    "completion is 1 of 4 actionable (25%), not 3 of 9 (33%)",
    stats.percentGreen === 25,
    `${stats.percentGreen}%`,
  );
  check(
    "red is 2 of 4 actionable (50%), not 5 of 9 (56%)",
    stats.percentRed === 50,
    `${stats.percentRed}%`,
  );
  check(
    "blue is 1 of 4 actionable (25%), not 1 of 9 (11%)",
    stats.percentBlue === 25,
    `${stats.percentBlue}%`,
  );

  check(
    "unassigned counts only claims that can be handed out",
    stats.unassignedCount === 1,
    `${stats.unassignedCount} — the fresh unassigned claim is not a gap to fill`,
  );

  console.log("\n=== the queue excludes fresh claims ===");

  const queueWhere = {
    assignedToId: biller.id,
    statusCategory: StatusCategory.RED,
    batch: { status: BatchStatus.OPEN, practiceId: practice.id },
  };

  const actionableQueue = await prisma.arClaim.count({
    where: { ...queueWhere, ...ACTIONABLE_WHERE },
  });
  const wholeQueue = await prisma.arClaim.count({ where: queueWhere });

  check(
    "the biller's queue holds only the aged red claim",
    actionableQueue === 1,
    String(actionableQueue),
  );
  check(
    "including fresh claims brings back all three",
    wholeQueue === 3,
    String(wholeQueue),
  );

  const completedQueue = await prisma.arClaim.count({
    where: {
      assignedToId: biller.id,
      statusCategory: StatusCategory.GREEN,
      batch: { status: BatchStatus.OPEN, practiceId: practice.id },
      ...ACTIONABLE_WHERE,
    },
  });
  check(
    "the completed tab shows the green claim they could work",
    completedQueue === 1,
    String(completedQueue),
  );

  console.log("\n=== reassigned to me ===");

  const note = (
    claimId: string,
    workedById: string,
    assignedToChangedId: string | null,
    workedAt: Date,
    text: string,
  ) =>
    prisma.arWorkNote.create({
      data: {
        claimId,
        outcomeType: OutcomeType.IN_PROCESS,
        structuredFields: {},
        generatedNote: text,
        statusChangedTo: "Pending",
        statusCategoryChangedTo: StatusCategory.RED,
        assignedToChangedId,
        workedById,
        workedAt,
      },
    });

  // The biller hands the aged red claim to the PM.
  await prisma.arClaim.update({
    where: { id: agedRed.id },
    data: { assignedToId: pm.id },
  });
  await note(
    agedRed.id,
    biller.id,
    pm.id,
    new Date("2026-02-01T10:00:00.000Z"),
    "ZZ needs a corrected claim form",
  );

  /**
   * A claim that reached the PM and then moved on. The latest hand-over names
   * somebody else, so it is not waiting on the PM — this is the case a naive
   * "any note pointing at me" check gets wrong.
   */
  await prisma.arClaim.update({
    where: { id: agedUnassigned.id },
    data: { assignedToId: otherBiller.id },
  });
  await note(
    agedUnassigned.id,
    biller.id,
    pm.id,
    new Date("2026-02-01T09:00:00.000Z"),
    "ZZ first hand-over, to the PM",
  );
  await note(
    agedUnassigned.id,
    pm.id,
    otherBiller.id,
    new Date("2026-02-02T09:00:00.000Z"),
    "ZZ answered — back to a biller",
  );

  // A PM assigning themselves a claim has not been handed anything.
  await prisma.arClaim.update({
    where: { id: freshUnassigned.id },
    data: { assignedToId: pm.id },
  });
  await note(
    freshUnassigned.id,
    pm.id,
    pm.id,
    new Date("2026-02-03T09:00:00.000Z"),
    "ZZ taking this one myself",
  );

  const handed = await manuallyReassignedTo({
    userId: pm.id,
    batchId: batch.id,
  });

  check(
    "the claim the biller passed over is detected",
    handed.claimIds.includes(agedRed.id),
    handed.claimIds.join(", "),
  );
  check(
    "a claim that has since moved on is not",
    !handed.claimIds.includes(agedUnassigned.id),
  );
  check(
    "a PM assigning themselves is not a hand-over",
    !handed.claimIds.includes(freshUnassigned.id),
  );
  check(
    "exactly one hand-over is waiting",
    handed.claimIds.length === 1,
    String(handed.claimIds.length),
  );

  const context = handed.context.get(agedRed.id);
  check(
    "the context names who passed it over",
    context?.reassignedByName === "ZZ Actionable Biller",
    context?.reassignedByName,
  );
  check(
    "the context carries their note, to save opening the claim",
    context?.note === "ZZ needs a corrected claim form",
    context?.note,
  );
  check(
    "the context carries their id, to route it straight back",
    context?.reassignedById === biller.id,
  );

  const count = await countReassignedToMe(pm.id, batch.id);
  check(
    "the badge counts the hand-over and the blue claim, without double-counting",
    count === 2,
    `${count} — one manual hand-over plus one blue escalation`,
  );

  const billerCount = await countReassignedToMe(biller.id, batch.id);
  check(
    "nothing is waiting on the biller who did the handing over",
    billerCount === 0,
    String(billerCount),
  );

  // Cleanup. Claims and notes cascade from the batch; the batch from the
  // practice.
  await prisma.practice.delete({ where: { id: practice.id } });
  await prisma.user.deleteMany({
    where: { id: { in: [pm.id, biller.id, otherBiller.id] } },
  });

  const leftover = await prisma.arClaim.count({
    where: { patientName: { startsWith: "ZZ " }, batchId: batch.id },
  });
  check("test rows cleaned up", leftover === 0, String(leftover));

  void freshGreen;
  void freshGreen2;
  void freshRed;
  void freshRed2;
  void agedGreen;
  void agedBlue;
}

main()
  .catch((error) => {
    console.error(error);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n${"=".repeat(60)}`);
    console.log(
      fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`,
    );
    console.log("=".repeat(60));
    process.exit(fail === 0 ? 0 : 1);
  });
