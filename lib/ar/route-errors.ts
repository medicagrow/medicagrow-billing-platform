import { apiErrorResponse } from "@/lib/api-helpers";
import { StatusRequestError } from "@/lib/ar/status-requests";

/**
 * Turns the typed errors `lib/ar/` throws into API responses, and anything
 * else back into a throw — an unexpected error should reach the logs, not be
 * dressed up as a 400.
 */
export function arErrorResponse(error: unknown) {
  if (error instanceof StatusRequestError) {
    return apiErrorResponse(error.message, error.status);
  }

  throw error;
}
