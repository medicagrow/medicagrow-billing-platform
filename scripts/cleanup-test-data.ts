/**
 * Clears test and sample data from a database, leaving a clean slate to launch
 * on.
 *
 *   npx tsx scripts/cleanup-test-data.ts             # preview, deletes nothing
 *   npx tsx scripts/cleanup-test-data.ts --confirm   # actually delete
 *
 * Preserved:
 *   - the owner account (OWNER_EMAIL below)
 *   - the nine default task types
 *   - every TrackerConfig row (the owner's scoring model)
 *
 * Everything else goes: practices, users, claims, batches, entries, notes,
 * tracker entries, tasks, todos and time blocks.
 *
 * This is irreversible and there is no undo. It runs against whatever
 * DIRECT_URL points at, which in production is production — take a Supabase
 * backup first.
 */

import path from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { Role } from "../lib/generated/prisma/enums";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

/** The one account that survives. */
const OWNER_EMAIL = "support@medicagrow.com";

/**
 * The task types that ship with the product, by name. Anything else in the
 * table was added during testing and goes with the rest.
 */
const DEFAULT_TASK_TYPES = [
  "Charge Posting",
  "Payment Posting",
  "Denial/Rejection Work",
  "Claim Follow-up",
  "Authorization",
  "Eligibility Check",
  "Report",
  "Patient Inquiry",
  "Clinic Inquiry",
];

// Bulk deletes are maintenance work, not app traffic: they belong on the
// session pooler, where a long transaction is not fighting for a connection
// that gets handed back after every statement.
const rawConnectionString =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!rawConnectionString) {
  throw new Error("DIRECT_URL / DATABASE_URL is not set. Check .env.local.");
}

const connectionString: string = rawConnectionString;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const confirmed = process.argv.includes("--confirm");

/** Right-pads a label so the counts line up in the output. */
function row(label: string, count: number) {
  console.log(`  ${label.padEnd(22)} ${String(count).padStart(6)}`);
}

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });

  // Without this check a typo in OWNER_EMAIL would match nobody, and "delete
  // every user except the owner" would delete every user.
  if (!owner) {
    throw new Error(
      `No user found with email ${OWNER_EMAIL}. Refusing to run: with no ` +
        `account to preserve this would delete every user and lock everyone ` +
        `out. Fix OWNER_EMAIL and try again.`,
    );
  }

  if (owner.role !== Role.OWNER) {
    throw new Error(
      `${OWNER_EMAIL} has role ${owner.role}, not OWNER. Refusing to run ` +
        `rather than leave the platform with no owner.`,
    );
  }

  if (!owner.isActive) {
    throw new Error(
      `${OWNER_EMAIL} is deactivated. Refusing to run rather than leave the ` +
        `platform with no account that can sign in.`,
    );
  }

  /* ------------------------------ preview ------------------------------ */

  const doomedUsers = await prisma.user.findMany({
    where: { email: { not: OWNER_EMAIL } },
    select: { email: true, name: true, role: true },
    orderBy: { email: "asc" },
  });

  const extraTaskTypes = await prisma.taskType.findMany({
    where: { name: { notIn: DEFAULT_TASK_TYPES } },
    select: { name: true },
  });

  const planned = {
    arWorkNotes: await prisma.arWorkNote.count(),
    eobWorkNotes: await prisma.eobWorkNote.count(),
    taskNotes: await prisma.taskNote.count(),
    todoNotes: await prisma.todoNote.count(),
    arClaims: await prisma.arClaim.count(),
    eobEntries: await prisma.eobEntry.count(),
    arBatches: await prisma.arBatch.count(),
    eobBatches: await prisma.eobBatch.count(),
    arDenialReasons: await prisma.arDenialReason.count(),
    trackerEntries: await prisma.trackerEntry.count(),
    tasks: await prisma.task.count(),
    todos: await prisma.todo.count(),
    timeBlocks: await prisma.timeBlock.count(),
    practiceProviders: await prisma.practiceProvider.count(),
    userPractices: await prisma.userPractice.count(),
    practices: await prisma.practice.count(),
    taskTypes: extraTaskTypes.length,
    users: doomedUsers.length,
  };

  const total = Object.values(planned).reduce((sum, count) => sum + count, 0);

  console.log(`\nDatabase: ${connectionString.replace(/:[^:@/]+@/, ":****@")}`);
  console.log(`\nPreserving:`);
  console.log(`  owner          ${owner.name} <${owner.email}>`);
  console.log(`  task types     ${DEFAULT_TASK_TYPES.length} defaults`);
  console.log(
    `  tracker config ${await prisma.trackerConfig.count()} row(s)`,
  );

  console.log(`\nWill delete ${total} record(s):`);
  for (const [label, count] of Object.entries(planned)) row(label, count);

  if (doomedUsers.length > 0) {
    console.log(`\nUser accounts to be deleted:`);
    for (const user of doomedUsers) {
      console.log(`  ${user.role.padEnd(16)} ${user.email} (${user.name})`);
    }
  }

  if (extraTaskTypes.length > 0) {
    console.log(`\nNon-default task types to be deleted:`);
    for (const type of extraTaskTypes) console.log(`  ${type.name}`);
  }

  if (!confirmed) {
    console.log(
      `\nPreview only — nothing was deleted.` +
        `\nRe-run with --confirm to apply:` +
        `\n\n  npx tsx scripts/cleanup-test-data.ts --confirm\n`,
    );
    return;
  }

  if (total === 0) {
    console.log(`\nNothing to delete. Database is already clean.\n`);
    return;
  }

  /* ------------------------------ delete ------------------------------- */

  console.log(`\nDeleting…\n`);

  // One transaction: an FK constraint tripping halfway through would
  // otherwise leave the database in a state nobody planned for.
  const deleted = await prisma.$transaction(
    async (tx) => {
      // Order matters — children before the rows they point at.

      // 1. Work notes and audit trails.
      const arWorkNotes = (await tx.arWorkNote.deleteMany({})).count;
      const eobWorkNotes = (await tx.eobWorkNote.deleteMany({})).count;
      const taskNotes = (await tx.taskNote.deleteMany({})).count;
      const todoNotes = (await tx.todoNote.deleteMany({})).count;

      // 2. Line items. EobEntry.arClaimId is SetNull, so claims may go first.
      const arClaims = (await tx.arClaim.deleteMany({})).count;
      const eobEntries = (await tx.eobEntry.deleteMany({})).count;

      // 3. The batches those belonged to.
      const arBatches = (await tx.arBatch.deleteMany({})).count;
      const eobBatches = (await tx.eobBatch.deleteMany({})).count;

      // 4. Reference data built up from real work.
      const arDenialReasons = (await tx.arDenialReason.deleteMany({})).count;
      const trackerEntries = (await tx.trackerEntry.deleteMany({})).count;

      // 5. Work items. Child task/todo instances cascade from their parents,
      //    so a single deleteMany covers both.
      const tasks = (await tx.task.deleteMany({})).count;
      const todos = (await tx.todo.deleteMany({})).count;
      const timeBlocks = (await tx.timeBlock.deleteMany({})).count;

      // 6. Practices and everything hanging off them.
      const practiceProviders = (await tx.practiceProvider.deleteMany({})).count;
      const userPractices = (await tx.userPractice.deleteMany({})).count;
      const practices = (await tx.practice.deleteMany({})).count;

      // 7. Task types the team added while testing.
      const taskTypes = (
        await tx.taskType.deleteMany({
          where: { name: { notIn: DEFAULT_TASK_TYPES } },
        })
      ).count;

      // 8. Users last: every table above holds a required reference to one,
      //    so none of them can go until those rows are gone.
      const users = (
        await tx.user.deleteMany({ where: { email: { not: OWNER_EMAIL } } })
      ).count;

      return {
        arWorkNotes,
        eobWorkNotes,
        taskNotes,
        todoNotes,
        arClaims,
        eobEntries,
        arBatches,
        eobBatches,
        arDenialReasons,
        trackerEntries,
        tasks,
        todos,
        timeBlocks,
        practiceProviders,
        userPractices,
        practices,
        taskTypes,
        users,
      };
    },
    // 1,896 claims is a lot of rows for the default 5s ceiling.
    { timeout: 120_000, maxWait: 20_000 },
  );

  console.log(`Deleted:`);
  for (const [label, count] of Object.entries(deleted)) row(label, count);

  const deletedTotal = Object.values(deleted).reduce(
    (sum, count) => sum + count,
    0,
  );

  /* ------------------------------ verify ------------------------------- */

  const remaining = {
    users: await prisma.user.count(),
    practices: await prisma.practice.count(),
    arClaims: await prisma.arClaim.count(),
    taskTypes: await prisma.taskType.count(),
    trackerConfig: await prisma.trackerConfig.count(),
  };

  console.log(`\nRemaining:`);
  for (const [label, count] of Object.entries(remaining)) row(label, count);

  const ownerSurvived = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { email: true },
  });

  if (!ownerSurvived) {
    throw new Error(
      `The owner account is gone after cleanup. Restore from backup.`,
    );
  }

  console.log(
    `\n${deletedTotal} record(s) deleted. Owner ${OWNER_EMAIL} intact, ` +
      `${remaining.taskTypes} task type(s) and ${remaining.trackerConfig} ` +
      `tracker config row(s) preserved.\n`,
  );
}

main()
  .catch((error) => {
    console.error(`\nCleanup failed — nothing was committed.\n`);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
