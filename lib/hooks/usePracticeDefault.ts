"use client";

import { usePractice } from "@/lib/contexts/PracticeContext";

export interface PracticeDefault {
  /** The globally selected practice, or null when "All Practices" is active. */
  practiceId: string | null;
  practiceName: string | null;
  /** True when a specific practice is selected and the field should be locked. */
  isLocked: boolean;
}

/**
 * Shared behaviour for every practice picker inside a form or modal.
 *
 * When the top-bar selector names a practice, forms adopt it and show it
 * read-only — the global filter is the single place that choice is made, and
 * letting a modal silently disagree with the toolbar is how work lands on the
 * wrong practice. With "All Practices" active the field is left blank and the
 * user must choose.
 */
export function usePracticeDefault(): PracticeDefault {
  const { selectedPracticeId, selectedPracticeName } = usePractice();

  return {
    practiceId: selectedPracticeId,
    practiceName: selectedPracticeName,
    isLocked: selectedPracticeId !== null,
  };
}
