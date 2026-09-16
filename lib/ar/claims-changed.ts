/**
 * A browser event announcing that claims in a batch changed.
 *
 * The batch page's claim list and its Pending Approvals panel are siblings —
 * neither renders the other — yet an approval in one changes what the other
 * should show. A window event keeps them in step without lifting both into one
 * component that knows about everything.
 */

export const CLAIMS_CHANGED_EVENT = "ar:claims-changed";

export function announceClaimsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CLAIMS_CHANGED_EVENT));
  }
}
