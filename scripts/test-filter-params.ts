/**
 * How list filters are written into and read back out of a query string.
 *
 *   npx tsx scripts/test-filter-params.ts
 *
 * Pure — no database, no dev server. This encoding is what makes the back
 * button restore a filtered list, so its edges are worth pinning: a value that
 * fails to round-trip silently drops somebody's filter.
 */

import {
  decodeFilterValue,
  encodeFilterValue,
  filterQuery,
  hasActiveFilters,
  mergeFilterParams,
  parseFilters,
} from "../lib/filter-params";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

console.log("=== a value equal to its default stays out of the URL ===");
{
  check("empty string omitted", encodeFilterValue("", "") === null);
  check("default page omitted", encodeFilterValue(1, 1) === null);
  check("false omitted", encodeFilterValue(false, false) === null);
  check("empty list omitted", encodeFilterValue([], []) === null);

  // Otherwise "clear filters" could not simply mean "drop the params".
  check("a set string is kept", encodeFilterValue("Aetna", "") === "Aetna");
  check("page 2 is kept", encodeFilterValue(2, 1) === "2");
  check("true is kept", encodeFilterValue(true, false) === "true");
  check(
    "a list is comma-joined",
    encodeFilterValue(["Aetna", "BCBS"], []) === "Aetna,BCBS",
  );
}

console.log("\n=== reading back uses the default to know the shape ===");
{
  check("a missing list reads as empty",
    Array.isArray(decodeFilterValue(null, [])) &&
      (decodeFilterValue(null, []) as string[]).length === 0);
  check("a missing string reads as its default", decodeFilterValue(null, "") === "");
  check("a missing number reads as its default", decodeFilterValue(null, 1) === 1);
  check("a missing boolean reads as false", decodeFilterValue(null, false) === false);

  check(
    "a comma list splits",
    (decodeFilterValue("Aetna,BCBS", []) as string[]).join("|") === "Aetna|BCBS",
  );
  check(
    "blank entries in a list are dropped",
    (decodeFilterValue("Aetna,,BCBS,", []) as string[]).length === 2,
  );
  check("a number parses", decodeFilterValue("3", 1) === 3);
  check("only \"true\" is true", decodeFilterValue("yes", false) === false);

  // A hand-edited URL must not poison the query it feeds.
  check("a nonsense number falls back", decodeFilterValue("banana", 1) === 1);
}

console.log("\n=== round trip ===");
{
  const defaults = {
    insurance: [] as string[],
    aging: [] as string[],
    search: "",
    page: 1,
    limit: 50,
    overdue: false,
  };

  const state = {
    insurance: ["Aetna", "BCBS"],
    aging: ["31-60"],
    search: "jones",
    page: 2,
    limit: 100,
    overdue: true,
  };

  const query = filterQuery(state, defaults);
  const back = parseFilters(new URLSearchParams(query), defaults);

  check(
    "every filter survives the trip",
    JSON.stringify(back) === JSON.stringify(state),
    query,
  );

  check(
    "the query names only what is set",
    filterQuery(defaults, defaults) === "",
    filterQuery(defaults, defaults),
  );

  // Deterministic order is what lets the hook tell its own writes apart from
  // a back-button navigation.
  check(
    "the key order is the declared order",
    query.startsWith("insurance=") && query.includes("aging="),
    query,
  );
}

console.log("\n=== foreign params are left alone ===");
{
  const defaults = { search: "", page: 1 };

  // The top bar owns practiceId; a filter bar must not clear it.
  const existing = new URLSearchParams("practiceId=abc123&search=old&page=4");
  const merged = mergeFilterParams(existing, { search: "new", page: 1 }, defaults);

  check("a foreign param survives", merged.get("practiceId") === "abc123");
  check("an owned param updates", merged.get("search") === "new");
  check(
    "an owned param back at its default is removed",
    merged.get("page") === null,
    merged.toString(),
  );
}

console.log("\n=== knowing when to offer 'clear filters' ===");
{
  const defaults = { search: "", practice: [] as string[], page: 1, limit: 50 };

  check(
    "nothing set means nothing to clear",
    !hasActiveFilters({ ...defaults }, defaults, ["page", "limit"]),
  );
  check(
    "a search counts",
    hasActiveFilters({ ...defaults, search: "x" }, defaults, ["page", "limit"]),
  );
  check(
    "a chosen practice counts",
    hasActiveFilters({ ...defaults, practice: ["p1"] }, defaults, [
      "page",
      "limit",
    ]),
  );
  // Paging through an unfiltered list is not filtering it.
  check(
    "paging does not count",
    !hasActiveFilters({ ...defaults, page: 3 }, defaults, ["page", "limit"]),
  );
  check(
    "nor does page size",
    !hasActiveFilters({ ...defaults, limit: 200 }, defaults, ["page", "limit"]),
  );
}

console.log("\n=== a seeded default can still be cleared ===");
{
  /**
   * Some lists open from a link that names a filter — the Team page sends you
   * to /tasks/list?assignedToId=X — and that seed becomes the default. If
   * clearing it wrote nothing to the URL, reading the URL back would restore
   * the seed and the filter would refuse to clear.
   */
  const seeded = { assignedToId: "user-1", status: "CLOSED", tags: ["a"] };

  check(
    "clearing a seeded string is recorded",
    encodeFilterValue("", "user-1") === "",
  );
  check("clearing a seeded list is recorded", encodeFilterValue([], ["a"]) === "");
  check(
    "turning off a seeded boolean is recorded",
    encodeFilterValue(false, true) === "false",
  );
  check(
    "a value still at its seed stays out",
    encodeFilterValue("user-1", "user-1") === null,
  );

  const cleared = { assignedToId: "", status: "", tags: [] as string[] };
  const query = filterQuery(cleared, seeded);
  const back = parseFilters(new URLSearchParams(query), seeded);

  check(
    "the cleared state survives a round trip",
    back.assignedToId === "" && back.status === "" && back.tags.length === 0,
    query,
  );

  // An untouched seeded list still reads back as the seed.
  const untouched = parseFilters(new URLSearchParams(""), seeded);
  check(
    "an omitted seeded list reads back as its seed",
    untouched.tags.join(",") === "a",
    untouched.tags.join(","),
  );
}

console.log(`\n${"=".repeat(60)}`);
console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
console.log("=".repeat(60));
process.exit(fail === 0 ? 0 : 1);
