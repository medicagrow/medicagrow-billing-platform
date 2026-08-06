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

### Batch claim list

- **Assignee dropdowns offer the practice's own people, plus Owners** —
  `practiceAssignees()` in [lib/ar-access.ts](lib/ar-access.ts), used by the
  batch page and `GET /api/ar/batches/[batchId]`. Owners hold no
  `UserPractice` rows but reach everything, so they are added explicitly;
  offering the whole staff list let a batch be handed to somebody who cannot
  open it.
- Five filters AND together: insurance, aging, provider, date-of-service range
  and a patient/CPT search. **Each filter that needs an OR of its own goes into
  an `AND: []` array** rather than a top-level `OR` key, which the object
  spread would silently overwrite. The provider filter matches
  `renderingProvider` **or** `providerName`, because the column shows
  whichever the claim has.
- The search box debounces 300 ms — a request per keystroke lets a slow early
  response land after a fast later one.
- `visitId` and `visitStatus` are optional reference fields some EHRs export.
  Auto-detected by the standard parser, **hidden by default** in the claim
  table, and toggled per browser from the Columns menu. `visit_status` is
  resolved before `visit_id` so the more specific header claims its column
  first — a bare "Visit" would otherwise take either.

### Claim visibility rules

- The biller queue (`/api/ar/claims/my-queue`) enforces four conditions in one
  database query — assigned to caller, RED, batch OPEN, and the batch's
  practice in the caller's `UserPractice` rows. Never filter these in JS after
  the query or the pagination counts drift from the rows.
- Owners skip the practice condition: they hold implicit access to everything
  and have no `UserPractice` rows, so the join would empty their queue.
- `/api/ar/claims` narrows **billers** to their own claims; PMs and Owners see
  the whole batch.

## Productivity module

Cross-module reporting lives in [lib/productivity/](lib/productivity/) and is
built to take more modules without touching the routes or pages.

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
- `/productivity` filters live in the **URL** (`preset`/`from`/`to`,
  `userIds`, `practiceIds`), so the page stays a server component and any view
  of the report is a link. Both lists are re-narrowed against
  `accessiblePracticeIds()` server-side.
- The **AR dashboard's biller panel** is `arBillerActivity()` in
  [lib/ar-summary.ts](lib/ar-summary.ts), shared by the page and
  `/api/ar/dashboard`. Note counts and the roster are both practice-scoped: a
  PM sees their practices' work, by the people who share those practices.
- `GET /api/settings/practices` is scoped the same way — a PM lists the
  practices they manage, and the detail page 404s for the others.

```bash
npx tsx scripts/test-notes.ts      # generated note text, retired outcomes
npx tsx scripts/test-my-queue.ts   # queue scoping (needs the dev server)
npx tsx scripts/test-tracker-scoring.ts  # practice health scoring model
```

### Time Log & Efficiency

`/productivity/time-logs`, Owner and PM only. The aggregation lives in
[lib/time-analysis.ts](lib/time-analysis.ts) and is shared by
`GET /api/time-logs/summary` and `GET /api/time-logs/sessions`, so the totals
and the rows behind them cannot disagree.

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
