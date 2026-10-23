/**
 * Owner settings that are not about one module.
 *
 * Same trade `getTrackerConfig()` makes: seed the default on first read, cache
 * for five minutes per instance, and invalidate on write so a save takes
 * effect at once rather than up to five minutes later.
 *
 * Deliberately separate from `TrackerConfig`, which configures the practice
 * health score. Two tables with a key and a JSON blob look like duplication
 * until you ask which one configures the tracker.
 */

import { prisma } from "@/lib/prisma";

/** How long a single timer session may run before the sweep stops it. */
export const MAX_SESSION_MINUTES_KEY = "timer.maxSessionMinutes";

/**
 * Ten hours, just under the 10.5-hour shift window (02 F-01).
 *
 * This is the fallback rule, and in Phase 1 it is the *only* rule: per-shift
 * auto-stop times need the shift table, which arrives with F-01. A session
 * this long is already wrong whatever shift the person is on — the longest
 * genuine one in the book before this shipped was six days.
 */
export const DEFAULT_MAX_SESSION_MINUTES = 600;

interface Cached<T> {
  value: T;
  readAt: number;
}

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, Cached<unknown>>();

export function invalidateAppSettingCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}

/**
 * Reads a numeric setting, seeding the default when the row is missing.
 *
 * A bad stored value — someone typing "ten" into a JSON column, or a zero
 * that would stop every timer the moment it started — falls back to the
 * default rather than taking the sweep down with it.
 */
export async function getNumberSetting(
  key: string,
  fallback: number,
): Promise<number> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.readAt < CACHE_MS) return hit.value as number;

  const row = await prisma.appSetting.findUnique({
    where: { settingKey: key },
    select: { settingValue: true },
  });

  if (!row) {
    await prisma.appSetting.create({
      data: { settingKey: key, settingValue: fallback },
    });

    cache.set(key, { value: fallback, readAt: Date.now() });
    return fallback;
  }

  const stored = Number(row.settingValue);
  const value = Number.isFinite(stored) && stored > 0 ? stored : fallback;

  cache.set(key, { value, readAt: Date.now() });
  return value;
}

export async function setNumberSetting(
  key: string,
  value: number,
  updatedById: string,
): Promise<void> {
  await prisma.appSetting.upsert({
    where: { settingKey: key },
    create: { settingKey: key, settingValue: value, updatedById },
    update: { settingValue: value, updatedById },
  });

  invalidateAppSettingCache(key);
}

export const getMaxSessionMinutes = () =>
  getNumberSetting(MAX_SESSION_MINUTES_KEY, DEFAULT_MAX_SESSION_MINUTES);
