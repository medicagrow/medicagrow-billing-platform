import { EhrSource } from "@/lib/generated/prisma/enums";

/**
 * Display labels for each EHR.
 *
 * Deliberately separate from lib/ar-parsers — importing that index pulls the
 * whole xlsx parser into whatever bundle touches it, and client components
 * only ever need the labels.
 */
export const EHR_SOURCE_LABELS: Record<EhrSource, string> = {
  [EhrSource.OPEN_PM]: "OpenPM",
  [EhrSource.SIMPLE_PRACTICE]: "SimplePractice",
  [EhrSource.THERAPYNOTE]: "Therapynote",
  [EhrSource.ECW]: "eCW",
  [EhrSource.OFFICE_ALLY]: "OfficeAlly / Practicemate",
};

/** File extensions each EHR is expected to export, for upload validation. */
export const EHR_SOURCE_EXTENSIONS: Record<EhrSource, string[]> = {
  [EhrSource.OPEN_PM]: [".xlsx"],
  [EhrSource.SIMPLE_PRACTICE]: [".xlsx"],
  [EhrSource.THERAPYNOTE]: [".xlsx"],
  [EhrSource.ECW]: [".csv", ".tsv", ".txt"],
  [EhrSource.OFFICE_ALLY]: [".xls", ".xlsx"],
};
