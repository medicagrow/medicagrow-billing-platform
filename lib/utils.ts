export type ClassValue = string | false | null | undefined;

/** Minimal className joiner — no runtime dependency needed for this. */
export function cn(...classes: ClassValue[]) {
  return classes.filter(Boolean).join(" ");
}
