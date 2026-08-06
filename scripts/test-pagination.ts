/**
 * Page-number elision and the AR claim filter combination.
 *
 *   npx tsx scripts/test-pagination.ts
 *
 * Pure — no database, no dev server.
 */

import { isPageSize, pageSlots, PAGE_SIZE_OPTIONS } from "../components/ui/Pagination";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const show = (page: number, total: number) =>
  pageSlots(page, total)
    .map((slot) => (slot === "gap" ? "..." : String(slot)))
    .join(" ");

console.log("=== short lists are shown whole ===");
{
  check("one page", show(1, 1) === "1", show(1, 1));
  check("seven pages, no gaps", show(4, 7) === "1 2 3 4 5 6 7", show(4, 7));
  check("no page is ever missing", pageSlots(4, 7).length === 7);
}

console.log("\n=== long lists elide the middle ===");
{
  // The spec's own example.
  check("page 8 of 20", show(8, 20) === "1 2 ... 7 8 9 ... 19 20", show(8, 20));

  check(
    "near the start there is only one gap",
    show(2, 20) === "1 2 3 ... 19 20",
    show(2, 20),
  );
  check(
    "near the end likewise",
    show(19, 20) === "1 2 ... 18 19 20",
    show(19, 20),
  );
  check(
    "the first and last pages are always reachable",
    pageSlots(10, 40).includes(1) && pageSlots(10, 40).includes(40),
  );
  check(
    "the current page is always shown",
    pageSlots(23, 40).includes(23),
    show(23, 40),
  );
  check(
    "and so are its neighbours",
    pageSlots(23, 40).includes(22) && pageSlots(23, 40).includes(24),
  );
}

console.log("\n=== a gap of one page is filled, not elided ===");
{
  // Page 4 of 20 leaves only page 3 between the edge and the window: showing
  // "..." there would be wider than the number it hides.
  check("page 4 of 20", show(4, 20) === "1 2 3 4 5 ... 19 20", show(4, 20));
  /** Every gap must hide at least two pages, across every page of every size. */
  const badGaps: string[] = [];

  for (let total = 8; total <= 40; total += 1) {
    for (let page = 1; page <= total; page += 1) {
      const slots = pageSlots(page, total);

      slots.forEach((slot, index) => {
        if (slot !== "gap") return;

        const before = slots[index - 1];
        const after = slots[index + 1];

        if (
          typeof before === "number" &&
          typeof after === "number" &&
          after - before <= 2
        ) {
          badGaps.push(`page ${page} of ${total}: ${before} … ${after}`);
        }
      });
    }
  }

  check(
    "no '...' ever stands for a single page",
    badGaps.length === 0,
    badGaps.slice(0, 3).join("; "),
  );
}

console.log("\n=== page sizes ===");
{
  check("50 is offered", isPageSize(50));
  check("500 is offered", isPageSize(500));
  check("25 is not", !isPageSize(25));
  check("a string is not", !isPageSize("50"));
  check("nothing stored is not", !isPageSize(undefined));
  check(
    "the options are the four the spec names",
    PAGE_SIZE_OPTIONS.join(",") === "50,100,200,500",
    PAGE_SIZE_OPTIONS.join(","),
  );
}

console.log(`\n${"=".repeat(60)}`);
console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
console.log("=".repeat(60));
process.exit(fail === 0 ? 0 : 1);
