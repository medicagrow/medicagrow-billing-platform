-- Consolidates three EOB statuses that duplicated others.
--
-- Data only: no schema changes. statusLabel is a plain text column, so the
-- old values would otherwise linger on existing rows and render as unknown
-- statuses, which eobStatusToCategory() treats as RED.
--
-- Column names are camelCase and therefore quoted. The AR module has its own
-- "Corrected and Resubmitted" in ar_claims/ar_work_notes; those tables are
-- deliberately untouched.

-- "Corrected and Resubmitted" -> "Resubmitted"
--    The note detail already records whether a correction was made.
UPDATE eob_entries
   SET "statusLabel" = 'Resubmitted'
 WHERE "statusLabel" = 'Corrected and Resubmitted';

-- "Awaiting Info from Practice" -> "Check with Office"
--    Both meant the same handoff. The category moves with it: the old label
--    was BLUE already, but setting it explicitly keeps rows consistent even
--    if one was written with a mismatched category.
UPDATE eob_entries
   SET "statusLabel" = 'Check with Office',
       "statusCategory" = 'BLUE'
 WHERE "statusLabel" = 'Awaiting Info from Practice';

-- "Duplicate — Ignore" -> "Duplicate"
UPDATE eob_entries
   SET "statusLabel" = 'Duplicate'
 WHERE "statusLabel" = 'Duplicate — Ignore';

-- The work-note trail records what a status was changed *to*, so the same
-- three renames apply or the history stops matching the entries.
UPDATE eob_work_notes
   SET "statusChangedTo" = 'Resubmitted'
 WHERE "statusChangedTo" = 'Corrected and Resubmitted';

UPDATE eob_work_notes
   SET "statusChangedTo" = 'Check with Office',
       "statusCategoryChangedTo" = 'BLUE'
 WHERE "statusChangedTo" = 'Awaiting Info from Practice';

UPDATE eob_work_notes
   SET "statusChangedTo" = 'Duplicate'
 WHERE "statusChangedTo" = 'Duplicate — Ignore';
