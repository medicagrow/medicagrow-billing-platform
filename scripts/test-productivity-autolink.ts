/**
 * Auto-linked productivity: counting the work, not remembering it.
 *
 *   npx tsx scripts/test-productivity-autolink.ts
 *
 * The rule under test is an intersection of two things: **the sessions a
 * biller's timer recorded**, and **the notes they wrote inside those
 * sessions**. Everything that can go wrong here is a boundary — a note a
 * minute before the timer started, a note by somebody else, a note against
 * another practice — so the fixtures put one of each just outside the window
 * and check it is left out.
 *
 * Creates ZZ-prefixed rows and removes them at the end. It never touches real
 * data.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import {
  BatchStatus,
  EhrSource,
  EobEntryType,
  OutcomeType,
  Role,
  StatusCategory,
  TaskStatus,
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

/** A fixed day, so the windows below read as clock times rather than offsets. */
const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 2, 10, hour, minute, 0, 0));

async function main() {
  const { autoLinkProductivity } = await import(
    "../lib/task/productivity-auto-link"
  );

  const owner = await prisma.user.findFirst({
    where: { role: Role.OWNER, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("no owner user to hang the fixtures on");

  const biller = await prisma.user.create({
    data: {
      name: "ZZ Autolink Biller",
      email: `zz-autolink-biller-${STAMP}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.BILLER,
    },
  });

  const otherBiller = await prisma.user.create({
    data: {
      name: "ZZ Autolink Other",
      email: `zz-autolink-other-${STAMP}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.BILLER,
    },
  });

  const [practice, otherPractice] = await Promise.all([
    prisma.practice.create({
      data: {
        name: `ZZ Autolink Practice ${STAMP}`,
        ehrSource: EhrSource.OPEN_PM,
      },
    }),
    prisma.practice.create({
      data: {
        name: `ZZ Autolink Other Practice ${STAMP}`,
        ehrSource: EhrSource.OPEN_PM,
      },
    }),
  ]);

  /**
   * The task types are matched by **name**, case-insensitively, because the
   * list is owner-editable data. Upserted rather than created so a re-run and
   * a real seeded list both work.
   */
  const followUpType = await prisma.taskType.upsert({
    where: { name: "Claim Follow-up" },
    update: {},
    create: { name: "Claim Follow-up", sortOrder: 900 },
  });

  const denialType = await prisma.taskType.upsert({
    where: { name: "Denial/Rejection Work" },
    update: {},
    create: { name: "Denial/Rejection Work", sortOrder: 901 },
  });

  const adminType = await prisma.taskType.upsert({
    where: { name: "Report" },
    update: {},
    create: { name: "Report", sortOrder: 902 },
  });

  const makeTask = (
    title: string,
    taskTypeId: string,
    practiceId: string | null,
  ) =>
    prisma.task.create({
      data: {
        title,
        taskTypeId,
        practiceId,
        createdById: owner.id,
        assignedToId: biller.id,
        status: TaskStatus.OPEN,
      },
    });

  const session = (taskId: string, from: Date, to: Date, userId = biller.id) =>
    prisma.taskTimeLog.create({
      data: {
        taskId,
        userId,
        startedAt: from,
        stoppedAt: to,
        durationMinutes: Math.round((to.getTime() - from.getTime()) / 60_000),
      },
    });

  // ------------------------------------------------------------------ AR

  console.log("=== Claim Follow-up counts AR notes inside the sessions ===");

  const arTask = await makeTask("ZZ Autolink AR", followUpType.id, practice.id);

  // Two sessions with a gap between them: the timer stops for a meeting and
  // starts again, so the window is a set of intervals rather than one span.
  await session(arTask.id, at(9), at(10));
  await session(arTask.id, at(14), at(15));

  const arBatch = await prisma.arBatch.create({
    data: {
      practiceId: practice.id,
      ehrSource: EhrSource.OPEN_PM,
      reportMonth: 3,
      reportYear: 2026,
      status: BatchStatus.OPEN,
      uploadedById: owner.id,
      totalClaims: 0,
      totalBalance: "0.00",
    },
  });

  const otherArBatch = await prisma.arBatch.create({
    data: {
      practiceId: otherPractice.id,
      ehrSource: EhrSource.OPEN_PM,
      reportMonth: 3,
      reportYear: 2026,
      status: BatchStatus.OPEN,
      uploadedById: owner.id,
      totalClaims: 0,
      totalBalance: "0.00",
    },
  });

  const makeClaim = (batchId: string, name: string) =>
    prisma.arClaim.create({
      data: {
        batchId,
        patientName: `ZZ ${name}`,
        insuranceName: "ZZ Insurance",
        dateOfService: new Date("2026-01-05T00:00:00.000Z"),
        balance: "100.00",
        agingDays: 60,
      },
    });

  const [claimA, claimB] = await Promise.all([
    makeClaim(arBatch.id, "AR claim A"),
    makeClaim(otherArBatch.id, "AR claim B"),
  ]);

  const arNote = (claimId: string, workedAt: Date, workedById = biller.id) =>
    prisma.arWorkNote.create({
      data: {
        claimId,
        outcomeType: OutcomeType.IN_PROCESS,
        structuredFields: {},
        generatedNote: "ZZ autolink note",
        statusChangedTo: "Pending",
        statusCategoryChangedTo: StatusCategory.RED,
        workedById,
        workedAt,
      },
    });

  await Promise.all([
    // Inside the first session.
    arNote(claimA.id, at(9, 15)),
    arNote(claimA.id, at(9, 45)),
    // Exactly on a boundary — inclusive at both ends.
    arNote(claimA.id, at(10, 0)),
    // Inside the second session.
    arNote(claimA.id, at(14, 30)),
    // In the gap between sessions: worked off the clock, not counted.
    arNote(claimA.id, at(12, 0)),
    // A minute before the timer started.
    arNote(claimA.id, at(8, 59)),
    // Somebody else's work, inside the window.
    arNote(claimA.id, at(9, 30), otherBiller.id),
    // This biller, in the window, but another practice's claim.
    arNote(claimB.id, at(9, 30)),
  ]);

  const ar = await autoLinkProductivity(arTask.id, biller.id);

  check("the source is the AR module", ar.source === "AR", String(ar.source));
  check(
    "counts only this biller's notes, in this practice, inside a session",
    ar.count === 4,
    `${ar.count} — 2 in the morning session, 1 on its closing boundary, 1 in the afternoon`,
  );
  check(
    "an AR follow-up carries no dollar figure",
    ar.amount === null,
    "the balance belongs to the claim, not to the act of chasing it",
  );
  check(
    "the window reported is the first start to the last stop",
    ar.from?.getTime() === at(9).getTime() &&
      ar.to?.getTime() === at(15).getTime(),
    `${ar.from?.toISOString()} → ${ar.to?.toISOString()}`,
  );
  check("both sessions were used", ar.sessionCount === 2, String(ar.sessionCount));

  // ----------------------------------------------------------------- EOB

  console.log("\n=== Denial/Rejection Work counts EOB notes and sums them ===");

  const eobTask = await makeTask(
    "ZZ Autolink EOB",
    denialType.id,
    practice.id,
  );

  await session(eobTask.id, at(11), at(12));

  const eobBatch = await prisma.eobBatch.create({
    data: {
      practiceId: practice.id,
      batchDate: new Date("2026-03-01T00:00:00.000Z"),
      payerName: "ZZ Payer",
      totalAmount: "0.00",
      postedById: owner.id,
    },
  });

  const makeEntry = (deniedAmount: string) =>
    prisma.eobEntry.create({
      data: {
        eobBatchId: eobBatch.id,
        entryType: EobEntryType.DENIAL,
        patientName: "ZZ EOB patient",
        dateOfService: new Date("2026-02-01T00:00:00.000Z"),
        denialReason: "ZZ test denial",
        deniedAmount,
        statusCategory: StatusCategory.RED,
        statusLabel: "Pending",
      },
    });

  const [entryA, entryB] = await Promise.all([
    makeEntry("125.50"),
    makeEntry("74.50"),
  ]);

  const eobNote = (entryId: string, workedAt: Date, workedById = biller.id) =>
    prisma.eobWorkNote.create({
      data: {
        entryId,
        note: "ZZ autolink eob note",
        statusChangedTo: "Pending",
        statusCategoryChangedTo: StatusCategory.RED,
        workedById,
        workedAt,
      },
    });

  await Promise.all([
    eobNote(entryA.id, at(11, 10)),
    eobNote(entryB.id, at(11, 50)),
    // Outside the session.
    eobNote(entryA.id, at(13, 0)),
    // Somebody else, inside it.
    eobNote(entryB.id, at(11, 20), otherBiller.id),
  ]);

  const eob = await autoLinkProductivity(eobTask.id, biller.id);

  check("the source is the EOB module", eob.source === "EOB", String(eob.source));
  check(
    "counts only this biller's notes inside the session",
    eob.count === 2,
    String(eob.count),
  );
  check(
    "sums the denied amounts of the entries worked",
    eob.amount?.toString() === "200",
    `${eob.amount?.toString()} — 125.50 + 74.50, in Decimal rather than a float`,
  );

  // --------------------------------------------------------------- edges

  console.log("\n=== edges ===");

  const noPracticeTask = await makeTask(
    "ZZ Autolink no practice",
    followUpType.id,
    null,
  );

  await session(noPracticeTask.id, at(9), at(10));

  const noPractice = await autoLinkProductivity(noPracticeTask.id, biller.id);

  check(
    "a task with no practice counts the window's work whatever practice it was for",
    noPractice.count === 4,
    `${noPractice.count} — the 3 in-window notes on this practice plus the one on the other`,
  );

  const adminTask = await makeTask("ZZ Autolink report", adminType.id, practice.id);
  await session(adminTask.id, at(9), at(10));

  const admin = await autoLinkProductivity(adminTask.id, biller.id);

  check(
    "a task type with no module behind it is left to manual entry",
    admin.source === null && admin.count === null,
    `source=${admin.source} count=${admin.count}`,
  );

  const untimedTask = await makeTask(
    "ZZ Autolink untimed",
    followUpType.id,
    practice.id,
  );

  const untimed = await autoLinkProductivity(untimedTask.id, biller.id);

  check(
    "no timer means zero, not unknown",
    untimed.count === 0 && untimed.source === "AR",
    "the type is auto-counted, so reporting null would hand it back to whoever is typing",
  );

  const runningTask = await makeTask(
    "ZZ Autolink running",
    followUpType.id,
    practice.id,
  );

  await prisma.taskTimeLog.create({
    data: { taskId: runningTask.id, userId: biller.id, startedAt: at(9) },
  });

  const running = await autoLinkProductivity(runningTask.id, biller.id);

  check(
    "a timer still running has no window and counts nothing",
    running.count === 0,
    `${running.count} — an unstopped session has no end to bound the window`,
  );

  // Cleanup. Notes, claims, entries and logs cascade from their parents.
  await prisma.task.deleteMany({
    where: { title: { startsWith: "ZZ Autolink" } },
  });
  await prisma.practice.deleteMany({
    where: { id: { in: [practice.id, otherPractice.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [biller.id, otherBiller.id] } },
  });

  const leftover = await prisma.task.count({
    where: { title: { startsWith: "ZZ Autolink" } },
  });
  check("test rows cleaned up", leftover === 0, String(leftover));
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
