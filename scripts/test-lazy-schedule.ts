/**
 * The rate limit in front of the cron-substitute sweeps.
 *
 *   npx tsx scripts/test-lazy-schedule.ts
 *
 * Pure — no database, no dev server. A gate that suppressed too much would
 * stop held work coming back and stop recurring occurrences appearing, which
 * fails quietly, so the edges are worth pinning down.
 */

import {
  DEFAULT_SWEEP_INTERVAL_MS,
  resetSweepClock,
  runAtMostEvery,
} from "../lib/lazy-schedule";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  console.log("=== it runs, then holds off ===");
  {
    resetSweepClock();
    let runs = 0;
    const sweep = async () => {
      runs += 1;
    };

    const first = await runAtMostEvery("job", 60_000, sweep);
    const second = await runAtMostEvery("job", 60_000, sweep);
    const third = await runAtMostEvery("job", 60_000, sweep);

    check("the first call runs", first === true);
    check("the next ones do not", second === false && third === false);
    check("the sweep ran exactly once", runs === 1, String(runs));
  }

  console.log("\n=== the window expires ===");
  {
    resetSweepClock();
    let runs = 0;
    const sweep = async () => {
      runs += 1;
    };

    await runAtMostEvery("job", 5, sweep);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = await runAtMostEvery("job", 5, sweep);

    check("it runs again once the interval passes", again === true);
    check("twice in total", runs === 2, String(runs));
  }

  console.log("\n=== keys are separate scopes ===");
  {
    resetSweepClock();
    const ran: string[] = [];

    // The real call sites pass a user id in the key. One person's sweep must
    // never suppress another's.
    await runAtMostEvery("due:alice", 60_000, async () => {
      ran.push("alice");
    });
    await runAtMostEvery("due:bob", 60_000, async () => {
      ran.push("bob");
    });
    await runAtMostEvery("due:alice", 60_000, async () => {
      ran.push("alice again");
    });

    check(
      "a second scope is not blocked by the first",
      ran.join(",") === "alice,bob",
      ran.join(","),
    );
  }

  console.log("\n=== a failed sweep is not counted as done ===");
  {
    resetSweepClock();
    let attempts = 0;

    const failing = async () => {
      attempts += 1;
      throw new Error("payer portal down");
    };

    let threw = false;
    try {
      await runAtMostEvery("job", 60_000, failing);
    } catch {
      threw = true;
    }

    check("the error reaches the caller", threw);

    // Without clearing the mark, one transient failure would suppress the
    // sweep for the whole interval.
    let secondThrew = false;
    try {
      await runAtMostEvery("job", 60_000, failing);
    } catch {
      secondThrew = true;
    }

    check("the next call retries rather than skipping", secondThrew);
    check("both attempts actually ran", attempts === 2, String(attempts));
  }

  console.log("\n=== concurrent calls do not both sweep ===");
  {
    resetSweepClock();
    let runs = 0;

    const slow = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
    };

    const results = await Promise.all([
      runAtMostEvery("job", 60_000, slow),
      runAtMostEvery("job", 60_000, slow),
      runAtMostEvery("job", 60_000, slow),
    ]);

    check(
      "only one of three concurrent calls runs",
      results.filter(Boolean).length === 1,
      results.join(","),
    );
    check("the sweep ran once", runs === 1, String(runs));
  }

  console.log("\n=== the interval is five minutes ===");
  check(
    "long enough to matter, short enough to be invisible",
    DEFAULT_SWEEP_INTERVAL_MS === 5 * 60 * 1000,
    String(DEFAULT_SWEEP_INTERVAL_MS),
  );
}

main()
  .catch((error) => {
    console.error(error);
    fail++;
  })
  .finally(() => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
    console.log("=".repeat(60));
    process.exit(fail === 0 ? 0 : 1);
  });
