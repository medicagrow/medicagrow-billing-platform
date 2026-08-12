# MedicaGrow Billing Operations Platform

Multi-module medical billing operations SaaS. Internal use first, then sold to
other medical billing companies.

- **Built:** AR Follow-Up, EOB/ERA Denials & Rejections, Practice Health
  Tracker, Task Management, To Do Management, Productivity reporting, Settings.
- **Planned:** Eligibility.
- **Roles:** `OWNER`, `PROJECT_MANAGER`, `BILLER`

## Cross-cutting conventions

- **Zod optional fields:** a `.transform()` pipeline hides the fact that
  `undefined` is acceptable, so Zod treats an absent key as *missing*. Any
  optional field built from a transform chain must end in `.optional()`, or
  partial payloads fail validation. This has bitten identifiers, EOB, todo and
  tracker schemas — check it first when a valid-looking request 400s.
- **All timestamps display in IST (Asia/Kolkata).** Use `formatDateTimeIST()`
  / `formatDateIST()` / `formatTimeIST()` from
  [lib/timezone.ts](lib/timezone.ts) — never `Date.toLocaleString()` without an
  explicit timezone, which renders in the server's zone on a server component
  and the viewer's on a client one. Storage stays UTC and does not change.
  **Date-only fields are not timestamps**: due dates, dates of service and
  report months are calendar dates at UTC midnight, so they keep going through
  `formatDate()` in [lib/format.ts](lib/format.ts), which is deliberately UTC —
  shifting them into IST would move some of them a day.
- **Queue scoping:** every "my queue" enforces assigned-to-caller + RED +
  practice membership in one query. Owners skip the practice join since they
  hold no `UserPractice` rows.
- **Blue status escalates through one chain**, resolved by
  `resolveEscalationTarget()` in [lib/escalation.ts](lib/escalation.ts) and
  shared by AR and EOB so the two cannot drift: the practice's
  `primaryPmId` → the batch owner (`uploadedById` for AR, `postedById` for
  EOB) → the oldest active Owner. A **deactivated** primary PM is skipped —
  assigning into a queue nobody reads is worse than falling through. If the
  whole chain resolves to nobody, the claim/entry keeps its current assignee
  rather than being orphaned.
- Work-note tables (`ar_work_notes`, `eob_work_notes`, `task_notes`) are
  **add-only**.
- **Round trips are the cost, not queries.** The database answers in under
  6 ms; a round trip to it is 5–10 ms co-located and 200 ms+ from the wrong
  region. So the thing to count when a page is slow is **how many queries it
  issues**, not how complex they are. Two rules follow, and both have been
  broken before:
  - **Never one query per row.** A report over N people runs a fixed number of
    queries, not N × anything. Providers in [lib/productivity/](lib/productivity/)
    take `userIds: string[]` and return results keyed by user for exactly
    this reason; the single-user pages call the same functions with one id, so
    there is one implementation rather than two that drift.
  - **Independent work goes in one `Promise.all`.** Awaiting stages in
    sequence spends a round trip waiting for each.
- **The cron-substitute sweeps are rate limited.** `checkHoldReleases()` and
  `generateDueInstances()` still run from the pages people load, but the
  request path calls the `…IfNeeded()` wrappers, which run each at most once
  every five minutes per instance via
  [lib/lazy-schedule.ts](lib/lazy-schedule.ts). Both decide things at *day*
  granularity, so deferring by minutes cannot change what they would do. The
  gate key carries the scope — one person's sweep must not suppress another's
  — and a failed sweep clears its mark so the next request retries. The
  ungated functions stay exported for tests and any future cron.
- **Roll-ups belong in SQL.** [lib/ar-aging-summary.ts](lib/ar-aging-summary.ts)
  and [lib/ar-insurance-aging.ts](lib/ar-insurance-aging.ts) bucket with a
  `CASE` in raw SQL rather than fetching every claim and filtering arrays —
  the result set should be the size of the table being drawn, not the size of
  the claim book. Raw SQL because Prisma's `groupBy` groups by a column, not
  by an expression over one; column names stay quoted since Prisma maps table
  names but not columns. `scripts/test-aging-rollups.ts` checks both against
  a JavaScript pass over the same rows.
- **Vercel runs in `bom1`**, beside the Supabase project in `ap-south-1`.
  Set in [vercel.json](vercel.json); if the database moves, move it too.
- **List filters live in the URL**, through `useFilterState()` in
  [lib/hooks/useFilterState.ts](lib/hooks/useFilterState.ts). React state does
  not survive a navigation, so filters held there were lost the moment somebody
  opened a row and pressed back. Three rules the hook keeps: **`replace`, not
  `push`** — a keystroke must not become a history entry; **local state
  renders and the URL follows** — deriving the inputs from `useSearchParams()`
  would make typing wait out the debounce; and **only declared keys are
  touched**, so the top bar's `practiceId` survives. Each list declares its
  defaults once as `FILTER_DEFAULTS`; the hook infers each value's shape from
  its default, omits anything still at its default, and resets `page` when any
  other filter moves. The encoding is in
  [lib/filter-params.ts](lib/filter-params.ts), free of React so it can be
  tested and read by server components.
  - **A hardcoded back link undoes all of this.** The browser's back button
    restores the query string; `<Link href="/ar/batches/123">` does not. Detail
    pages use [components/ui/BackLink.tsx](components/ui/BackLink.tsx), which
    calls `router.back()` when there is same-origin history and falls back to
    its `href` when someone arrived from a bookmark.
  - **Do not clamp the page before the first response.** `total` is 0 until
    it lands, so the page count is 1 and any restored page number would be
    thrown away. Every clamp waits on `loading`.
  - Page size is the exception that is **both**: the URL wins when it names
    one, so a shared link opens the view the sender saw, and `useLocalSetting`
    still remembers the choice for the next visit.
- **Paginated lists share one component.**
  [components/ui/Pagination.tsx](components/ui/Pagination.tsx) renders the page
  numbers (first two, last two, current ± 1, "…" between — and a gap of exactly
  one page is filled rather than elided), the 50/100/200/500 size selector and
  the "Showing X–Y of Z" line. Page size and optional-column choices persist
  per browser via `useLocalSetting()` in
  [lib/hooks/useLocalSetting.ts](lib/hooks/useLocalSetting.ts), which reads
  localStorage **after** mount — reading it during render would desynchronise
  the server's HTML from the client's first paint.
- **Practice pickers read the top bar.** `usePracticeDefault()` returns the
  globally selected practice; [components/ui/PracticeField.tsx](components/ui/PracticeField.tsx)
  renders it read-only with a "Change in top bar" hint when one is selected, and
  as a free dropdown under "All Practices". Any new form with a practice field
  uses it. The AR upload modal is the deliberate exception — a practice with an
  open batch cannot be uploaded to, so its picker is seeded but not locked.

## EOB module

- Status labels are canonical in [lib/eob-status.ts](lib/eob-status.ts) with
  their own label set; call `eobStatusToCategory()` rather than pairing by hand.
- A resolving status stamps `resolvedAt`/`resolvedById`; moving back off one
  clears them, so "avg days to resolve" stays honest.
- **The module is a flat list of entries, not of batches.** `/eob` lists every
  `EobEntry` across all batches; a batch has **no page of its own**. Batch data
  (payer, ERA#/reference, batch date) rides along as columns via the
  `EOB_BATCH_SELECT` join in [lib/eob-serialize.ts](lib/eob-serialize.ts).
  Do not reintroduce `/eob/batches/[batchId]`.
- `GET /api/eob/entries` owns the filtering and sorting: `entryType`,
  `statusCategory`, `practiceId`, `payerName` (substring), `assignedToId`, and
  `from`/`to` — which bound the **batch date**, not the date of service, since
  "last month's ERAs" means when the remittance arrived. Sorts: `batchDate`
  (default, newest first), `deniedAmount`, `patientName`, `payerName`,
  `status`.

## Tracker module

- Scoring lives in [lib/tracker/scoring.ts](lib/tracker/scoring.ts) and is the
  single source of truth — the form previews with it and the API saves with it.
- **A missing measure scores null, not zero**, and its weight is redistributed
  proportionally across the measures that do have data. Some EHRs cannot
  produce some reports; scoring those as zero would punish the practice for
  its vendor.
- Only `scoreA`…`scoreH` and `finalScore` are stored; everything else is
  recomputed on save. `LOCKED` entries reject edits and cannot be unlocked.
- The two financial rates are distinct measures, and the difference matters:
  - **Net collection rate** = `(payments + adjustments) / charges` — the share
    of billed charges that has been resolved either way. Drives Score A.
  - **Payment efficiency** = `payments / (payments + adjustments)` — of what was
    resolved, how much was actual cash.
  - Either can be replaced by an owner-entered `netCollectionRateManual` /
    `paymentEfficiencyManual` (Decimal, 0–1, nullable). Null means "use the
    calculation"; scoring reads the manual value whenever it is set, and the
    calculated figure stays visible beside it.
- **Weights and score bands are owner-configurable**, stored in `TrackerConfig`
  under `score_weights` and `score_ranges`.
  - Defaults, types and pure helpers live in
    [lib/tracker/config-defaults.ts](lib/tracker/config-defaults.ts) — **no
    Prisma**, so client components can import them.
    [lib/tracker/config.ts](lib/tracker/config.ts) adds the database reads and
    re-exports it.
  - `getTrackerConfig()` seeds the defaults on first read and caches for five
    minutes; `PATCH /api/tracker/config` calls `invalidateTrackerConfigCache()`
    so a save takes effect at once.
  - Weights are whole percentages under the letters `A`–`H` and must total 100
    (enforced in the schema and in the UI). `weightsByScoreKey()` converts them
    to `scoreA`-style keys as fractions for display.
  - **Bands are inclusive of their upper bound** — the spec reads "> 80 = 100",
    so a value of exactly 80 scores the 70–80 band.
  - Settings page is Owner only, at `/tracker/settings`.

## Tasks vs To Dos

Two separate systems with different audiences. They are not variants of each
other and must not be merged.

|  | **Tasks** (`Task`) | **To Dos** (`Todo`) |
| --- | --- | --- |
| Audience | everyone, incl. Billers | Owner and PM only |
| Purpose | assignable work, tracked to completion | personal daily planning |
| Routes | `/tasks`, `/tasks/team`, `/tasks/list` | `/todos`, `/todos/list`, `/todos/team` |
| Visibility to creator | `isVisibleToCreator` (default true) | `isShared` (default false) |
| Delegation | reassign | `subAssignedToId` — both keep it |
| Classification | `TaskType` (owner-managed) | none |
| Recurrence | parent/instance, own row per occurrence | 60-day generation, tops up on completion |
| Time blocks | no | yes — `TODO_WORK` capacity |
| Note log | `task_notes`, add-only | `todo_notes` |

- Both use `{ OPEN, IN_PROCESS, HOLD, CLOSED }`, as `TaskStatus` and
  `TodoStatus` — deliberately separate enums so a change to one cannot
  silently alter the other.
- **`HOLD` requires a `holdReleaseDate`.** Enforced in the Zod schema and again
  in the route, since a held item with no release date disappears silently.
- `checkHoldReleases()` in [lib/todo/hold-release.ts](lib/todo/hold-release.ts)
  returns expired holds to `OPEN` and appends
  "Auto-released from Hold on [date]". There is no scheduler, so it runs at the
  points people actually hit: `GET /api/todos/today`,
  `GET /api/tasks/my-tasks`, and the dashboard fetch in
  `app/(platform)/page.tsx`. Add it to any new entry point that lists work.
- **"Daily" means every business day.** `nextBusinessDay()` in
  [lib/task/recurrence-config.ts](lib/task/recurrence-config.ts) skips Saturday
  and Sunday, and a series set up over a weekend starts on the Monday. Weekly
  and bi-weekly already name their days and monthly lands on a date, so daily
  was the one frequency that had to be told.
  - **Both generators read the mark through `dueDateFor()`**, never raw.
    Advancing correctly is not enough on its own: the sweep runs whenever a
    page is loaded, including at the weekend, and a mark already sitting on a
    Saturday — left by the old rule, or by a hand-edited config — would
    otherwise become a Saturday task. A mark found on a weekend is corrected
    and stored, so it is repaired once rather than re-read every sweep. `scripts/fix-daily-recurring-weekends.ts`
  moves any weekend occurrence left by the old rule onto the following Monday —
  OPEN instances only, since a closed one is a record of work that happened.
- **A recurring parent never appears in a task list.** `GET /api/tasks`
  excludes `isRecurring && parentTaskId === null`; "Recurring only" narrows to
  `parentTaskId != null` rather than adding an `OR`, which used to overwrite
  the visibility filter's own `OR` and leak other practices' tasks.
- **Editing a series** goes through `PATCH /api/tasks/[taskId]/series`, which
  always updates the parent — leaving the template stale would mean the next
  occurrence undoes the correction — and reaches the occurrences named by
  `scope`: `future` (default), `this`, or `all`. `future` and `this` leave
  closed work alone so completed history stays true to what was done.
- **Deleting** is `DELETE /api/tasks/[taskId]` with the same scopes, Owner/PM
  only, and is a **hard** delete — unlike todos. These rows are removed because
  they should not exist, and a tombstone would have to be filtered out of every
  list and report forever.
- Task visibility ([lib/task-access.ts](lib/task-access.ts)): Billers see
  assigned-to-them plus created-by-them-and-visible; PMs add their practices'
  tasks; Owners see everything. Editing needs assignee, creator or Owner.
  **A PM's scope is the practice, not the person**: a task belonging to another
  practice stays hidden even when its assignee is someone the PM shares a
  practice with. Only a task with **no practice at all** is placed by who holds
  it. The Team page counts through `teamTaskScope()` for the same reason, so a
  shared biller's totals match the list they link to.
- **A closed task is out of the default list, not out of reach.** `GET
  /api/tasks` and `GET /api/tasks/my-tasks` both default to
  `{ OPEN, IN_PROCESS, HOLD }`; asking for `status=CLOSED` returns closed work,
  and the empty option in both dropdowns reads "Open, in process & hold" rather
  than claiming to show everything. My Tasks sends the status **to the API** —
  filtering it over already-fetched rows matched nothing, since the queue never
  fetched a closed task. Closed results order by `completedAt` desc: once the
  thing is done, the due date is the wrong axis.
  - This is also what made a **time-edit request look unavailable** after a
    close. The 48-hour window has always been measured from
    `TaskTimeLog.startedAt` with no reference to task status — but the task had
    vanished from My Tasks, so the panel holding the link could not be opened.
- **Productivity is counted, not typed, for the two module-backed task types.**
  `autoLinkProductivity()` in
  [lib/task/productivity-auto-link.ts](lib/task/productivity-auto-link.ts)
  intersects the biller's **stopped timer sessions** with the **AR or EOB work
  notes they wrote inside them**, scoped to the task's practice when it has
  one. Which types this covers is `autoSourceModule` in
  [productivity-config.ts](lib/task/productivity-config.ts), so the UI that
  says "auto-calculated" and the code that calculates cannot drift.
  - Run on close, in `PATCH /api/tasks/[taskId]`, and attributed to the
    **assignee** rather than whoever pressed close.
  - `GET /api/tasks/[taskId]/productivity-preview` runs the same function
    without writing, so the confirmation screen shows the number that will be
    saved rather than a second estimate of it. A count of 0 is an amber warning,
    not a block — working off the clock is a reason to check, not to refuse.
  - **No timer means 0, not null.** The type is auto-counted; returning null
    would hand it back to whoever is typing.
  - Manual entry for every other type now actually persists — `productivityCount`
    and `productivityAmount` were in the schema and posted by the form, but the
    route never wrote them.
- **PM/Owner correct a time log outright**, through `PATCH
  /api/tasks/time-logs/[logId]/direct-edit`. The request/approve flow exists so
  nobody edits *their own* logged time; a manager correcting somebody else's is
  not that situation, and filing a request to themselves would be a form with
  one signature on both lines. It keeps the overlap check and the
  once-only `originalDurationMinutes`, and drops the 48-hour window — that
  window protects against an unreviewed change, and this edit carries the
  manager's name. Scope is `canManageTaskTime()` in
  [lib/task-access.ts](lib/task-access.ts), deliberately wider than
  `canEditTask` (a PM may not rewrite another person's task but may fix its
  clock). Every such edit appears in the **Direct edits** table under the
  approval queue on Tasks → Team, since it has no second signature.
- **A biller cannot close a task with an empty timer** — `PATCH
  /api/tasks/[taskId]` returns 400 "Timer entry required before closing". PMs
  and Owners are exempt: they close work they manage but did not personally do.
  `actualMinutes` is **derived from `totalLoggedMinutes` on close**, never sent
  by the client, and the close form shows it read-only.
- Every task status change appends a `TaskNote`, with the caller's optional
  note joined on. The same now applies to todos.
- Recurrence in [lib/todo/recurrence.ts](lib/todo/recurrence.ts): creating a
  recurring todo generates 60 days of instances, and completing one tops the
  series up by one so it never runs dry.
- Deleting is a soft delete — the productivity module reports on completion
  history and hard deletes would rewrite it. Bulk delete on `/todos/list`
  closes with the note "Bulk deleted"; bulk **hold** is deliberately not
  offered, since each held item needs its own release date.
- **Sub-assignment** (`Todo.subAssignedToId`, Owner/PM only) is delegation, not
  reassignment: the todo stays in the assignee's list *and* appears in the
  sub-assignee's, each side labelled with the other's name. Visibility is
  `assignedToId = me OR subAssignedToId = me OR (createdById = me AND
  isShared)`. It answers to the same `canAssignTo()` rule as assigning.

### Task types

- `TaskType` is a global, owner-managed list (`/settings/task-types`), ordered
  by `sortOrder`. Nine defaults are seeded by `prisma/seed.ts`, **upserted by
  name** so re-seeding never duplicates a type or resets an owner's ordering.
- There is **no DELETE** — deactivating hides a type from the pickers while
  tasks already carrying it keep showing its name. Reordering swaps the two
  rows' `sortOrder` rather than renumbering the list.
- Completions break down by type in the productivity drill-down.

### Recurring tasks

Parent/instance, which is **not** how todos recur — a task occurrence is a real
row with its own status, completion and actual time, so "did we do this last
Tuesday" survives independently of the schedule.

- The **parent holds the config and is never work**: it carries no due date,
  and `GET /api/tasks/my-tasks` filters `isRecurring: false` so templates stay
  out of work queues.
- `recurringConfig.nextDueDate` is the high-water mark — the first occurrence
  not yet generated. Every generator advances it, so two concurrent calls
  cannot claim the same date, and a clash advances it anyway rather than
  wedging the series.
- Pure date arithmetic and types live in
  [lib/task/recurrence-config.ts](lib/task/recurrence-config.ts) — **no
  Prisma**, so the form can import it.
  [lib/task/recurrence.ts](lib/task/recurrence.ts) adds the writes and
  re-exports it.
- **An occurrence is created on its due date, not in advance.** Creating a
  series writes exactly one row (`generateFirstInstance()`); every later
  occurrence appears on the day it is due. A queue stacked with next week's
  work is noise, and closing one early records work against a day that has not
  happened.
  - `generateDueInstances()` is the scheduler. There is no cron, so it runs
    from `GET /api/tasks`, `GET /api/tasks/my-tasks` and the dashboard fetch —
    the same lazy-but-reliable pattern as `checkHoldReleases()`. Add it to any
    new entry point that lists tasks.
  - `createNextInstance()` (called when an occurrence closes) writes nothing
    while the next date is still in the future; the mark already names it.
  - A series dormant longer than `MAX_CATCH_UP` (7 days) is **fast-forwarded,
    not backfilled** — a month of backdated daily tasks helps nobody.
- Closing the **parent** calls `closeSeries()`, which closes every pending
  child with a note.
- `dayOfMonth` is capped at **28** so every month has the day.
- `actualMinutes` comes from the timer on close and is logged as its own
  note — that is where anyone comparing against the estimate will look.

```bash
npx tsx scripts/test-tasks.ts       # hold-release automation
npx tsx scripts/test-task-scoping.ts # PM sees their practices, not their billers'
npx tsx scripts/test-recurrence.ts  # recurrence dates, series generation, task types
npx tsx scripts/test-timer.ts       # task timer, edit window, overlap rule
npx tsx scripts/test-productivity-autolink.ts # counting AR/EOB work inside timer sessions
npx tsx scripts/test-schedule.ts    # 24h grid geometry, provider roster match
npx tsx scripts/test-eob-status.ts  # consolidated EOB status list
```

### My Day scheduling

- `TODO_WORK` time blocks define daily capacity; My Day warns when planned
  minutes exceed them.
- My Day navigates by date. Past days are read-only; today and later are not.
- **A weekly block is never rewritten to change one day.** A specific-date row
  with `overridesBlockId` set replaces that template block for that date, or
  removes it when `isHidden`. `resolveDaySchedule()` in
  [lib/todo/schedule.ts](lib/todo/schedule.ts) is the single place that applies
  these; `DELETE /api/time-blocks/overrides?date=` restores the template and
  deliberately leaves genuine one-off blocks alone.
- The schedule modal has two tabs: **Weekly Template** (multi-select days,
  with Weekdays/Weekend quick-picks, posting one row per day, and checkbox
  bulk delete) and **Specific Dates** (one-off blocks). Per-date overrides are
  not listed there — they belong to the day being viewed and are edited inline.
- The grid covers a **full 24 hours** at one pixel per minute
  ([components/todo/DayScheduleGrid.tsx](components/todo/DayScheduleGrid.tsx)),
  scrolled to 07:00 on load. A block whose end time is at or before its start
  has crossed midnight and renders as two segments, labelled "continues" and
  "continued" — night-shift blocks used to be cut off entirely.
- The viewed day is **URL state** (`/todos?date=YYYY-MM-DD`), so a day can be
  linked and reached with the back button. Today carries no param. Past days
  are read-only; today and later are editable.
- **One edit surface for todos.** `TodoEditPanel` is used by both My Day and
  the list view; there is deliberately no second, smaller panel.

## Project-wide coding conventions

@CONVENTIONS.md

## Stack notes

- Next.js 14 App Router, TypeScript, Tailwind CSS.
- **Prisma 7** on Supabase Postgres. Prisma 7 uses the query-compiler
  architecture, so:
  - Connection URLs are **not** in `schema.prisma` — they live in
    [prisma.config.ts](prisma.config.ts) (CLI) and [lib/prisma.ts](lib/prisma.ts)
    (runtime, via the `@prisma/adapter-pg` driver adapter).
  - The client generates to `lib/generated/prisma/` (gitignored). Import types
    from `@/lib/generated/prisma/client` and enums from
    `@/lib/generated/prisma/enums`.
  - Seed config lives in `prisma.config.ts`, not `package.json`.
- Two database URLs, and they are not interchangeable:
  - `DATABASE_URL` — transaction pooler (port 6543) for the running app.
  - `DIRECT_URL` — session pooler (port 5432) for migrations. DDL cannot run
    over the transaction pooler.
- NextAuth v4, JWT strategy, Credentials provider. Session carries
  `id`, `name`, `email`, `role`.
- Route structure: `app/(platform)/*` renders inside the authenticated shell
  (sidebar + topbar). `app/login` sits outside it. `middleware.ts` protects
  everything except `/login` and `/api/auth/*`.

## AR module notes

- Business rules enforced server-side, not in the UI: one OPEN batch per
  practice (409), closed batches reject notes (403), billers may only work
  claims assigned to them (403), blue status reassigns to `batch.uploadedById`.
- `statusCategoryChangedTo` is derived from the label server-side — never taken
  from the client. Same for `generatedNote`, which the API regenerates.
- `middleware.ts` returns **401 JSON for `/api/*`** and redirects only browser
  routes. Redirecting an XHR to the HTML login page makes clients fail with a
  JSON parse error instead of a usable message.
- Status labels are canonical in [lib/ar-status.ts](lib/ar-status.ts). Never
  pair a label with a category by hand — call `statusLabelToCategory()`.
- **Write Off and Check with Office are no longer outcome types.** They were
  never outcomes of a call — they were what you decided afterwards, so a denial
  ending in a write-off had to be filed as one or the other and lost its denial
  detail. Both remain in the `OutcomeType` enum, marked `@deprecated`, so
  historical notes still read; `OUTCOME_ORDER` no longer offers them. Their
  statuses now hang off PAID / DENIED / NO_CLAIM_ON_FILE / IN_PROCESS, and the
  fields they need are shown against the **status** — `needsWriteOffFields()`
  and `needsOfficeFields()` in [lib/ar-outcomes.ts](lib/ar-outcomes.ts).
  Switching away from such a status **clears** those fields, since the note
  generator reads whatever is in `fields`.
- **"Reassign to Practice PM"** on the note forms runs the same escalation
  chain a blue status does, at any status. Blue already reassigns, so the
  checkbox is forced on and disabled there rather than implying it caused it.
- Work-note text is built by `generateNote()` in
  [lib/ar-note-format.ts](lib/ar-note-format.ts), shared by the live preview
  and the API. `structuredFields` is a JSON column, so new note fields need no
  migration — add them to `NoteFields`, the form, and the generator together.
- "How Checked" gates the contact fields: Portal clears Spoke With / Ref# /
  Ph#, IVR clears Spoke With. Values are cleared as well as disabled so a
  stale entry cannot reach the saved note.
- Cross-practice roll-ups live in [lib/ar-summary.ts](lib/ar-summary.ts)
  (`arSummary`, `billerProgress`) and are shared by the homepage, the AR
  dashboard page and `/api/ar/dashboard` so the three cannot disagree.

### The 0–30 day rule

A claim aged **30 days or less is "not yet actionable"** — insurance has not
had time to process it, so calling about one is a wasted call. The flag is
**derived, never stored**: `isNotActionable()` / `ACTIONABLE_WHERE` /
`NOT_ACTIONABLE_WHERE` in [lib/ar-actionable.ts](lib/ar-actionable.ts), free of
Prisma so client components can import it.

They are **out of every list by default** and brought back by a checkbox. The
batch list first shipped showing them, on the reasoning that a PM needs the
whole book; in practice a freshly uploaded batch is mostly claims nobody may
act on, and they buried the workable ones. So:

- **My Queue** and the **batch claim list** both exclude them, both take
  `includeNotActionable=true`, and both render the same "Include 0–30 day
  claims" checkbox. The batch list's shows how many are hidden.
- **Selecting the 0–30 aging bucket also brings them back**, in the batch list.
  Without that, choosing that bucket returns an empty table, which reads as a
  broken filter rather than as a rule. `NOT_ACTIONABLE_BUCKET` names the key.
- The exclusion goes into the route's **`AND: []` array**, not the `where`
  object: a selected bucket already writes a top-level `agingDays`, and the
  object spread would silently drop one of the two.
- **Bulk assign** skips them and reports how many it skipped, unless its own
  "Include 0–30 day claims" checkbox is ticked. Enforced in the route rather
  than by filtering the selection in the browser: the list checkbox can put
  them back on screen, and a rule about what may be handed to a biller belongs
  where it cannot be bypassed. Unassigning is exempt — taking work back is
  never premature.
- **Every completion percentage** is over actionable claims alone, numerator
  and denominator both. `batchStats` keeps `greenCount`/`redCount`/`blueCount`
  over the **whole** batch — the close dialog must still see fresh unworked
  claims — and narrows only `percent*`, returning `notActionableCount` and
  `actionableClaims` so the page can say what it left out.
- `arSummary` and `billerProgress` are narrowed the same way, so the dashboard
  cards, the homepage and `/api/ar/dashboard` agree. The cards read from
  `arSummary` rather than re-summing the practice rows, which would disagree.
- **The aging badge is grey under 30 days, not green** — green reads as
  "healthy, nothing to do", and the truth is "nothing to do *yet*". The batch
  list spells it out with `<AgingBadge withLabel />`.
- The **insurance aging table still shows the 0–30 bucket in full**: it answers
  "what is outstanding", not "what can we act on". Both it and the summary
  cards carry a footnote saying which they are.

### Reassigned to Me

A claim reaches a manager's own name two ways, and
[lib/ar-reassignment.ts](lib/ar-reassignment.ts) treats both as one queue:

- a **blue status**, which `resolveEscalationTarget()` moves on save — the
  status is the only record, so the status *is* the signal; and
- a **manual hand-over** from the note form's "Reassign to Practice PM", which
  writes `assignedToChangedId` on the note.

The second cannot be read from the claim: `assignedToId` says who holds it now,
not how it got there. So `manuallyReassignedTo()` reads the note history and
takes the **most recent** note that changed the assignee — an earlier one that
has since been superseded does not count, and a manager who assigned themselves
a claim has not been handed anything. `DISTINCT ON` in raw SQL, so it is one
round trip for the whole batch rather than one per claim.

- Surfaces as a **"Reassigned to Me" tab** on the batch detail page and an
  amber count on the summary bar (Owner/PM only), and as a banner plus tab on
  My Queue for a manager who also works claims.
- `GET /api/ar/claims?reassignedToMe=true` returns the same set with the
  hand-over context attached — who passed it over, when, and their note — so
  the tab does not need a request per row.
- "Reassign" on a row seeds the assign dropdown with **whoever handed it over**,
  since answering their question and sending it back is the common case.

### Batch claim list

- **Assignee dropdowns offer the practice's own people, plus Owners** —
  `practiceAssignees()` in [lib/ar-access.ts](lib/ar-access.ts), used by the
  batch page and `GET /api/ar/batches/[batchId]`. Owners hold no
  `UserPractice` rows but reach everything, so they are added explicitly;
  offering the whole staff list let a batch be handed to somebody who cannot
  open it.
- Filters AND together: insurance, aging, provider, **assigned-to**,
  actionability, date-of-service range and a patient/CPT/visit-id search.
  **Each filter that needs an OR of its own goes into an `AND: []` array**
  rather than a top-level `OR` key, which the object spread would silently
  overwrite. The provider filter matches `renderingProvider` **or**
  `providerName`, because the column shows whichever the claim has.
- **"Assigned To" is a multi-select over the practice's own people, plus
  "Unassigned"** — which travels as its own `includeUnassigned` flag rather
  than a sentinel id in `assignedToIds`, because the API has no user by that
  name and a magic string in a list of ids is the kind of thing that later
  gets looked up. The two combine as an OR.
- The search box debounces 300 ms — a request per keystroke lets a slow early
  response land after a fast later one.
- The claim list's free-text box spans **three** fields — patient name, CPT
  and visit id — since a practice on the phone may quote any of them. The
  visit-status filter is only rendered when the batch actually carries visit
  statuses; an empty dropdown promises data that is not there.
- `visitId` and `visitStatus` are optional reference fields some EHRs export.
  Auto-detected by the standard parser, **hidden by default** in the claim
  table, and toggled per browser from the Columns menu. `visit_status` is
  resolved before `visit_id` so the more specific header claims its column
  first — a bare "Visit" would otherwise take either.

### Claim visibility rules

- The biller queue (`/api/ar/claims/my-queue`) enforces four conditions in one
  database query — assigned to caller, the view's status, batch OPEN, and the
  batch's practice in the caller's `UserPractice` rows. Never filter these in
  JS after the query or the pagination counts drift from the rows.
- **Three views over that one scope**, chosen by `view`: `active` (RED, the
  default), `completed` (GREEN, newest `lastWorkedAt` first — a biller's record
  of their own work) and `reassigned` (Owner/PM). Adding a view must not widen
  the scope, which is why the scope is built once and the view only adds a
  status. The tab counts come back on every response and honour the same
  filters, so switching tabs lands on what the badge promised.
  - The **date range means different things per view** — an active claim is
    filtered on when it is next due, a completed one on when it was finished.
  - Completed claims are still restricted to **open** batches: a closed batch is
    read-only history and appears nowhere in the queue.
  - Re-opening works for free — logging a red-status note on a green claim
    moves it back to the active view, since the view is the status.
- Its filters match the batch list: practice, insurance (multi-select), status,
  visit status (hidden when nothing in the caller's book has one), free-text
  search over patient/CPT/visit id, a date range, and the 0–30 day toggle.
  Option lists are built from the caller's **whole** book rather than the
  current view — a dropdown whose options change as you filter is one you
  cannot use to undo a filter.
- Owners skip the practice condition: they hold implicit access to everything
  and have no `UserPractice` rows, so the join would empty their queue.
- `/api/ar/claims` narrows **billers** to their own claims; PMs and Owners see
  the whole batch.

## Analytics module

Five reports under `/analytics`, Owner and PM only, built on
[lib/analytics/](lib/analytics/). They replaced the Team Productivity page and
the Time Log page, which are now **redirects** — `/productivity` →
`/analytics/time-productivity`, `/productivity/time-logs` →
`/analytics/session-log`, each translating its old query string on the way
through, since both were linked to with a person and a date range already
chosen. `/productivity/[userId]` and `.../detail` survive as the per-person
drill-down; the way in is now a biller row on the Time & Productivity report.

- **One vocabulary, five reports.** [lib/analytics/shared.ts](lib/analytics/shared.ts)
  owns `Measures`, `efficiencyRate()`, `secondsPerUnit()`, `sessionWhere()` and
  `closedTaskWhere()`. No report works a rate out a second way, so no two can
  disagree about the same window.
- **Grouped queries, never one per user.** Every provider takes id arrays and
  returns results keyed by id — the rule from the performance audit, and the
  reason a report over thirty billers is still a fixed number of round trips.
- Filters are the same everywhere and live in the **URL**, through
  `ANALYTICS_FILTER_DEFAULTS` / `useAnalyticsFilters()` in
  [components/analytics/AnalyticsShell.tsx](components/analytics/AnalyticsShell.tsx).
  A named period (`this_week`, `last_month`, …) **resolves to real dates the
  moment it is chosen** and the URL carries those, so a link sent on Friday
  still opens on the week it meant. [lib/analytics/periods.ts](lib/analytics/periods.ts)
  is free of React so a server component can resolve one too.
- Every route is `requireRole([OWNER, PROJECT_MANAGER])` and narrows the
  requested practices through `narrowPractices()` in
  [lib/analytics/request.ts](lib/analytics/request.ts) — a hand-edited query
  string cannot widen a PM's scope.
- **Flag vocabulary is Prisma-free.** `FLAG_TYPES`, `FLAG_LABELS`, `THRESHOLDS`
  and the result shapes live in [lib/analytics/flags.ts](lib/analytics/flags.ts);
  `suspicious-activity.ts` adds the queries and re-exports them. Importing the
  query module from a client component pulls `pg` into the browser bundle and
  fails the build — this happened, and this is the fix.

### The five reports

- **Time & Productivity** (`/analytics/time-productivity`) — time against
  output, nested three deep. `HIERARCHY` in
  [lib/analytics/time-productivity.ts](lib/analytics/time-productivity.ts) maps
  each Group By choice to its nesting order; the cells are computed once and
  folded, so switching the grouping re-nests rather than re-queries. An
  estimate is counted **once per task per group**, not once per session.
- **Workload Planner** (`/analytics/workload`) — assigned hours per biller per
  day. Past days read from `TaskTimeLog`, today and later from assigned
  estimates **plus AR daily rates plus `projectRecurringTasks()`**. Each day is
  a **stack**, not a flat colour: teal for AR, pale teal for another PM's AR,
  green/red for assigned work, hatched grey for projections — a full day made
  of three commitments needs to say which one to move. See "AR follow-up is a
  rate, not a deadline" below.
- **Resource Requirements** (`/analytics/resource-requirements`) — what each
  practice committed to against the hours booked to deliver it, per **month**,
  because a `PracticeRequirement` is per month and measuring a monthly
  commitment over eleven days compares unlike things. `unitsPerMonth` comes
  from three months of closed-task history and is **null when there is none**,
  never zero.
- **Suspicious Activity** (`/analytics/suspicious-activity`) — see below.
- **Session Log** (`/analytics/session-log`) — every timer session behind the
  other four, with its edit history and flags. "Flagged only" cannot be a
  database filter (flags are derived), so that one case reads the window and
  pages in memory; everything else pages in SQL.

### AR follow-up is a rate, not a deadline

Claim Follow-up carries `startDate` + `dailyHours` on `Task`, and the planner
spreads that rate across the **working days** between the start and the due
date. Every other task type is unchanged: its estimate lands on its due date.

The rules live in [lib/task/daily-hours.ts](lib/task/daily-hours.ts), free of
Prisma so the task form and the planner read the same ones.

- A biller is given a practice's book for the month and spends two hours a day
  on it. As a deadline that draws as one enormous Friday and nothing else —
  the opposite of what is happening. Two things fall out of the spread for
  free: **sequential** projects do not overlap, and **simultaneous** ones add
  up on each day rather than hiding behind each other.
- An unset `startDate` falls back to the task's `createdAt`, not the epoch:
  assigned work is being done from the moment it lands.
- **`dailyHours: null` on a Claim Follow-up means unconfigured, not zero.** It
  is counted nowhere and reported separately — as a summary card, a panel under
  the grid, and an alert. Counting it as zero would make a fully committed
  biller look free, which is the failure this whole model exists to prevent.
- The form shows both fields for that task type alone; the edit modal warns
  when an existing AR task has no daily hours.
- The AR query in `getWorkloadData()` matches on **range overlap**
  (`dueDate >= from AND start <= to`), not `dueDate` in the window — a task due
  on the 31st occupies every day before it.
- Recurring AR parents go through the same spread rather than the frequency
  walk, for the same reason.

**Multi-PM visibility is deliberate.** AR blocks are **not** narrowed by the
practice filter: a biller's day is consumed by every practice's AR, and a PM
planning around only their own would over-commit somebody already full. What
`viewerPracticeIds` decides is which blocks are labelled "(other PM)", drawn
paler, and not offered for editing — accurate capacity without exposing another
PM's task detail.

### Minutes per claim

[lib/analytics/claim-avg.ts](lib/analytics/claim-avg.ts) derives how long a
biller actually takes per claim, from closed Claim Follow-up tasks:
`totalLoggedMinutes ÷ productivityCount`, both of which are measured rather
than typed.

- **Minimum five tasks** — two is an anecdote, not a rate — then it falls back
  to the team average and reports which it used. Summed then divided, never an
  average of per-task rates, so a two-claim task cannot swing it.
- Cached an hour per instance, the same trade `lib/lazy-schedule.ts` makes.
  `claimRatesFor()` resolves a whole roster in **one grouped query**.
- **Currently unreferenced.** It backed a capacity sidebar on the AR batch
  page, which was removed — capacity planning belongs in the Workload Planner,
  and the batch page points there instead. Kept for the planner to use.

**The AR batch page does not do capacity planning.** It is a claim list, a bulk
assign control and a close button; the assign bar carries a link to
`/analytics/workload` rather than a second screen's worth of numbers.

```bash
npx tsx scripts/test-daily-hours.ts  # spread, sequential, simultaneous, unconfigured, non-AR
```

### Recurring-task projection

[lib/task/workload-projection.ts](lib/task/workload-projection.ts) answers
"what *would* be due" without writing anything. It exists because an occurrence
is only created on its due date, so a forward-looking plan has nothing to read.

- `projectRecurringTasks(from, to, filters?)` walks each active parent's
  `recurringConfig` through all four frequencies — daily (business days only,
  via `nextBusinessDay()`), weekly, bi-weekly and monthly — from
  `nextDueDate` forward, stopping at `endDate`, the window, or `MAX_STEPS`.
- **It never writes.** No `create`, no advancing of `nextDueDate`. A report
  must not change the schedule it is reporting on.
- Dates where a real child instance already exists are **skipped**, found by
  one query across every parent rather than one per parent.

### Suspicious activity

Every flag is a **question, not an accusation**, which is why each can be
dismissed and why the dismissal is recorded with a name. Flags are recomputed
from the logs on every request rather than stored, so changing a threshold
re-reads history correctly instead of leaving stale rows behind.

- Four types, thresholds in `THRESHOLDS`:
  - `SHORT_TIMER` — under **5 minutes** logged against an estimate of **30
    minutes or more**.
  - `EXTREME_OVERRUN` — **3× the estimate** or worse.
  - `NO_PRODUCTIVITY` — closed with time logged but no units recorded.
  - `PATTERN` — **3 or more** of the same flag for the same person and task
    type; 5 or more is red rather than amber. Only `SHORT_TIMER` and
    `NO_PRODUCTIVITY` roll into patterns — an overrun repeats for honest
    reasons.
- What is stored is only the **decision to stop showing a flag**:
  `AnalyticsFlagDismissal`, keyed by a `flagKey` that identifies the same
  finding next time (`SHORT_TIMER:<timeLogId>`, `PATTERN:<type>:<biller>:<type>`).
- "Flag for review" files a real `Task` for the manager, carrying the **task
  type of the work it is about**. There is no dedicated review type, and
  seeding one would put a row in a list the owner curates.

### Practice requirements

`PracticeRequirement` (practice × task type → `monthlyHours`, unique on the
pair) is the source the resource report measures against. Set on the **Monthly
Requirements** tab of a practice's settings page.

- A **blank** field clears the requirement (DELETE); **0** is a real
  commitment of no hours. The distinction is the same one `PercentInput` and
  the tracker form keep, and the report relies on it — a practice with no
  requirement reads "unset", not "short".

```bash
npx tsx scripts/test-projection.ts          # all 4 frequencies, skips real instances, endDate
npx tsx scripts/test-suspicious-activity.ts # each flag type against its threshold
```

## Productivity module

Cross-module reporting lives in [lib/productivity/](lib/productivity/) and is
built to take more modules without touching the routes or pages. It still backs
the per-person `/productivity/[userId]` pages and the AR dashboard.

- To add a module: write `getXProductivity` / `getXActivityDetail` /
  `getXRecentActivity` and add them to the three arrays in
  [lib/productivity/index.ts](lib/productivity/index.ts). Nothing else changes.
- Task and To Do completions are their own modules (`TASK`, `TODO`) in
  [lib/productivity/work-productivity.ts](lib/productivity/work-productivity.ts),
  keyed on `completedAt` and attributed to whoever closed the item. They used
  to hang off the AR module; they no longer do.
- Activity keys and labels live in `ar-activities.ts`, **free of Prisma**, so
  client components can import them. `ar-productivity.ts` holds the queries —
  importing it (or the index) from a client component pulls `pg` into the
  browser bundle and fails the build.
- Counts are derived from the `ar_work_notes` audit trail and measure work
  *logged in the window*, so a past period's report never changes.
- "Claims worked" and "moved to green" count **distinct claims**; the rest
  count notes.
- The practice filter is one helper, `practiceFilterFor()` in
  [lib/productivity/types.ts](lib/productivity/types.ts): the top bar's single
  `practiceId` wins, otherwise the report's own `practiceIds` multi-select.
- Time and task-type output live in
  [lib/productivity/task-time.ts](lib/productivity/task-time.ts). Time is
  selected by **`startedAt`**, exactly as the Time Log module does, so the
  hours on the two pages are the same hours; the **Overall efficiency card
  calls `getTimeLogSummary()`** rather than working the rate out a second way.
- The task-type breakdown shows only types with a **closed** task in the
  window — the question is what got finished. Time on a type that closed
  nothing still counts towards the total.
- The per-person pages' filters live in the **URL** (`preset`/`from`/`to`,
  `practiceId`), so they stay server components and any view is a link. The
  practice list is re-narrowed against `accessiblePracticeIds()` server-side.
- The **AR dashboard's biller panel** is `arBillerActivity()` in
  [lib/ar-summary.ts](lib/ar-summary.ts), shared by the page and
  `/api/ar/dashboard`. Note counts and the roster are both practice-scoped: a
  PM sees their practices' work, by the people who share those practices.
- `GET /api/settings/practices` is scoped the same way — a PM lists the
  practices they manage, and the detail page 404s for the others.

```bash
npx tsx scripts/test-notes.ts      # generated note text, retired outcomes
npx tsx scripts/test-aging-rollups.ts  # SQL roll-ups match a JS pass
npx tsx scripts/test-lazy-schedule.ts  # sweep rate limit, per scope
npx tsx scripts/test-filter-params.ts  # URL filter round trip, foreign params
npx tsx scripts/test-visit-status.ts   # the filter's options query, on real batches
npx tsx scripts/test-my-queue.ts   # queue scoping (needs the dev server)
npx tsx scripts/test-tracker-scoring.ts  # practice health scoring model
```

### Time Log & Efficiency

The aggregation in [lib/time-analysis.ts](lib/time-analysis.ts) is shared by
`GET /api/time-logs/summary` and `GET /api/time-logs/sessions`, so the totals
and the rows behind them cannot disagree. Its page is now
`/analytics/session-log`; the rules below still hold, and the analytics
reports read time the same way.

- **Sessions are the unit of time; tasks are the unit of estimate.** Logged
  minutes come from `task_time_logs`; the estimate is one number on the task.
  Summing the estimate per session would count it once per session, so
  estimates are gathered from the distinct tasks the sessions touched.
- **Efficiency = logged ÷ estimated × 100**, so *lower is better*: under 100%
  is green, 100–120% amber, above 120% red. A task with **no estimate is
  excluded from the rate, not counted as zero** — the same principle as a
  missing tracker measure.
- **Overrun = logged > estimated**, and only for tasks that have an estimate.
  Exactly on the estimate is not an overrun. A task is attributed as an
  overrun to every biller who logged against it.
- Sessions are selected by **`startedAt`** and must have stopped — a running
  timer has no duration yet. A past period's numbers therefore never change.
- Both routes narrow the requested practices against `accessiblePracticeIds()`,
  so a hand-edited query string cannot widen a PM's scope.

```bash
npx tsx scripts/test-time-logs.ts   # efficiency rate, overrun detection, breakdowns
npx tsx scripts/test-escalation.ts  # blue-status fallback chain
npx tsx scripts/test-actionable.ts  # the 0–30 day rule, and hand-over detection
```

### Import format — standard CSV only

The five EHR-specific parsers (OpenPM, SimplePractice, Therapynote, eCW,
OfficeAlly) **have been removed**. PMs standardise their EHR export outside the
app and upload one CSV shape, parsed by
[lib/ar-parsers/standard-csv.ts](lib/ar-parsers/standard-csv.ts).

- `Practice.ehrSource` is **reference/reporting only** — it no longer selects a
  parser. `ArBatch.ehrSource` is inherited from the practice at upload time.
- Required columns: `patient_name`, `date_of_service`, `provider_name`,
  `insurance_name`, `billed_amount`, `balance`. Optional: `cpt_code`,
  `claim_number`, `subscriber_id`, `patient_id`, `aging_days`.
- Columns are **auto-detected** by similarity ([lib/ar-parsers/detect.ts](lib/ar-parsers/detect.ts)):
  exact → punctuation-insensitive → containment. Each column is claimed by at
  most one field, resolved in `FIELD_RESOLUTION_ORDER`, so a generic alias
  cannot steal a column a more specific field matched.
- `patient_name` falls back to merging `first_name` + `last_name`.
- Dates are normalised to MM/DD/YYYY, and **the day/month order is decided once
  for the whole column** ([lib/ar-parsers/dates.ts](lib/ar-parsers/dates.ts)).
  Deciding per row would silently mix orders in a DD/MM file.
- Row errors are collected, not thrown on first failure; bad rows are skipped
  and reported. Above a 20% bad-row rate the import aborts — but only for files
  with more than 10 data rows.
- The upload modal parses the CSV **in the browser** and shows a mapping step
  where every field is a dropdown over the file's columns, plus a live 5-row
  data preview. Auto-detection only seeds the dropdowns.
- The confirmed mapping is posted as a `fieldMapping` form field and passed to
  the parser as `ParserOptions.fieldMapping`. When present, **no detection runs**
  — what the PM previewed is what imports. Column values are header text, or
  `MERGE_SENTINEL` (`__merge__`) for the first+last merge.
- The server still validates the mapping: required fields left unmapped are
  rejected with 422, so a bad mapping cannot slip through the client.
- Date/amount normalisation is shared by preview and import. Calendar helpers
  live in [lib/calendar.ts](lib/calendar.ts) (no Zod) so client components can
  use them without pulling validation into the bundle.
- `xlsx` has been **removed** as a dependency. Do not reintroduce it — the npm
  build stops at 0.18.5 with two unfixed high-severity advisories.
- Template PMs download: `public/templates/ar-claims-template.csv`.

```bash
npx tsx scripts/test-parsers.ts            # built-in parser checks
npx tsx scripts/test-parsers.ts file.csv   # parse a real file
```

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint
npm run db:migrate   # prisma migrate dev
npm run db:seed      # owner user + default task types
npm run db:studio    # prisma studio
```

`db:seed` needs `SEED_OWNER_PASSWORD` and refuses to run without it — a default
password committed to the repository is a published credential. It never resets
an existing owner's password. Deployment steps and the full environment
variable list live in [DEPLOYMENT.md](DEPLOYMENT.md).
