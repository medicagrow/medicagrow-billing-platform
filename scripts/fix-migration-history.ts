/**
 * Restores rows deleted from `_prisma_migrations`.
 *
 *   npx tsx scripts/fix-migration-history.ts --dry-run   # report only
 *   npx tsx scripts/fix-migration-history.ts             # insert what's missing
 *
 * Only the ledger is repaired. No DDL runs and no schema object is touched —
 * this is for the case where the tables a migration created are still there
 * but Prisma's record that it ran is not, which makes `migrate status` report
 * the migration as pending and `migrate deploy` try to apply it again.
 *
 * Prisma's own `prisma migrate resolve --applied <name>` does the same thing
 * one migration at a time. This handles the whole directory in one pass and,
 * more usefully, verifies the checksum algorithm against the rows that
 * survived before writing anything.
 *
 * Safe to re-run: migrations that already have a row are left alone.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const MIGRATIONS_DIR = path.resolve(process.cwd(), "prisma", "migrations");

const dryRun = process.argv.includes("--dry-run");

// Migrations are DDL history: they belong on the session pooler, the same
// connection the Prisma CLI uses (see prisma.config.ts).
const connectionString = process.env.DIRECT_URL;

if (!connectionString) {
  throw new Error(
    "DIRECT_URL is not set. It must point at the session pooler (port 5432), " +
      "the same URL the Prisma CLI uses.",
  );
}

interface MigrationFile {
  name: string;
  checksum: string;
  /** Parsed from the folder's timestamp prefix. */
  timestamp: Date;
}

/**
 * Prisma's checksum is the SHA-256 of the migration file's raw bytes — no
 * normalisation, no line-ending translation. Verified against the surviving
 * rows before this script writes anything.
 */
function checksumOf(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Folder names are `YYYYMMDDHHMMSS_slug`, stamped in UTC when the migration
 * was created. That is the closest thing to the original applied-at time we
 * still have, and it keeps the restored rows in the right order relative to
 * the ones that survived.
 */
function timestampFrom(name: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(name);

  if (!match) {
    throw new Error(`Migration folder "${name}" has no timestamp prefix.`);
  }

  const [, year, month, day, hour, minute, second] = match;

  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
}

function readMigrations(): MigrationFile[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`No migrations directory at ${MIGRATIONS_DIR}`);
  }

  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    // Folder names are timestamp-prefixed, so lexical order is chronological.
    .sort()
    .map((name) => {
      const sql = path.join(MIGRATIONS_DIR, name, "migration.sql");

      if (!fs.existsSync(sql)) {
        throw new Error(`${name} has no migration.sql — refusing to guess.`);
      }

      return { name, checksum: checksumOf(sql), timestamp: timestampFrom(name) };
    });
}

const client = new Client({ connectionString });

async function main() {
  const migrations = readMigrations();

  console.log(`\n${migrations.length} migration(s) on disk.`);

  await client.connect();

  const { rows: existing } = await client.query<{
    migration_name: string;
    checksum: string;
    finished_at: Date | null;
    rolled_back_at: Date | null;
  }>(
    `select migration_name, checksum, finished_at, rolled_back_at
       from _prisma_migrations`,
  );

  const byName = new Map(existing.map((row) => [row.migration_name, row]));

  /* ---------------------- verify before writing ----------------------- */

  // If the checksums we compute disagree with the rows that survived, the
  // algorithm is wrong (or a migration file was edited after being applied)
  // and every row we insert would be wrong too. Stop instead.
  const mismatched: string[] = [];
  let verified = 0;

  for (const migration of migrations) {
    const row = byName.get(migration.name);
    if (!row) continue;

    if (row.checksum === migration.checksum) verified += 1;
    else mismatched.push(migration.name);
  }

  if (mismatched.length > 0) {
    throw new Error(
      `Checksum mismatch on ${mismatched.length} migration(s) that already ` +
        `have a row:\n  ${mismatched.join("\n  ")}\n\n` +
        `Either the migration file changed after it was applied, or the ` +
        `checksum rule differs from what this script assumes. Refusing to ` +
        `insert anything, since the new rows would be just as wrong.`,
    );
  }

  console.log(
    `Checksum rule verified against ${verified} surviving row(s).`,
  );

  /* --------------------------- what's missing -------------------------- */

  const missing = migrations.filter(
    (migration) => !byName.has(migration.name),
  );

  // A row that exists but was rolled back is a different problem: the
  // migration is recorded as failed, not absent, and re-inserting would not
  // help. Surface it rather than silently doing nothing.
  const rolledBack = existing.filter((row) => row.rolled_back_at !== null);

  if (rolledBack.length > 0) {
    console.log(
      `\nWarning — ${rolledBack.length} migration(s) are marked rolled back:`,
    );
    for (const row of rolledBack) console.log(`  ${row.migration_name}`);
    console.log(
      "  These need 'prisma migrate resolve', not a re-insert.",
    );
  }

  const unfinished = existing.filter(
    (row) => row.finished_at === null && row.rolled_back_at === null,
  );

  if (unfinished.length > 0) {
    console.log(
      `\nWarning — ${unfinished.length} migration(s) have no finished_at:`,
    );
    for (const row of unfinished) console.log(`  ${row.migration_name}`);
  }

  if (missing.length === 0) {
    console.log(`\nNothing missing — every migration has a row.\n`);
    return;
  }

  console.log(`\n${missing.length} migration(s) missing from the ledger:`);
  for (const migration of missing) {
    console.log(`  ${migration.name}`);
    console.log(`    checksum    ${migration.checksum}`);
    console.log(`    applied at  ${migration.timestamp.toISOString()} (from the folder name)`);
  }

  if (dryRun) {
    console.log(`\nDry run — nothing was written.\n`);
    return;
  }

  /* ----------------------------- restore ------------------------------ */

  console.log(`\nRestoring…\n`);

  // One transaction: a partial restore would leave the ledger in a third
  // state that is neither the problem nor the fix.
  await client.query("begin");

  try {
    for (const migration of missing) {
      await client.query(
        `insert into _prisma_migrations
           (id, checksum, migration_name, started_at, finished_at,
            applied_steps_count, logs, rolled_back_at)
         values ($1, $2, $3, $4, $5, $6, null, null)`,
        [
          crypto.randomUUID(),
          migration.checksum,
          migration.name,
          migration.timestamp,
          // The real duration is not recoverable, so the row records the
          // migration as having finished at the moment it started.
          migration.timestamp,
          1,
        ],
      );

      console.log(`  restored  ${migration.name}`);
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  /* ----------------------------- verify ------------------------------- */

  const { rows: after } = await client.query<{
    migration_name: string;
    checksum: string;
  }>(`select migration_name, checksum from _prisma_migrations`);

  const afterByName = new Map(after.map((row) => [row.migration_name, row]));

  const stillMissing = migrations.filter(
    (migration) => !afterByName.has(migration.name),
  );

  const badChecksums = migrations.filter((migration) => {
    const row = afterByName.get(migration.name);
    return row !== undefined && row.checksum !== migration.checksum;
  });

  // Rows in the ledger with no folder on disk — not something this script
  // creates, but worth reporting, since it is the other way the two can
  // disagree and it also makes `migrate status` unhappy.
  const orphaned = after.filter(
    (row) => !migrations.some((migration) => migration.name === row.migration_name),
  );

  console.log(`\nLedger now holds ${after.length} row(s) for ${migrations.length} migration(s) on disk.`);

  if (stillMissing.length > 0) {
    console.log(`  still missing: ${stillMissing.map((m) => m.name).join(", ")}`);
  }
  if (badChecksums.length > 0) {
    console.log(`  wrong checksum: ${badChecksums.map((m) => m.name).join(", ")}`);
  }
  if (orphaned.length > 0) {
    console.log(`  in the database but not on disk: ${orphaned.map((r) => r.migration_name).join(", ")}`);
  }

  if (
    stillMissing.length === 0 &&
    badChecksums.length === 0 &&
    orphaned.length === 0
  ) {
    console.log(
      `\nRestored ${missing.length} record(s). Run 'npx prisma migrate status' ` +
        `to confirm.\n`,
    );
  }
}

main()
  .catch((error) => {
    console.error(`\nFailed — no rows were written.\n`);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => undefined);
  });
