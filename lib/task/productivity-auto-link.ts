import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { productivityConfigFor } from "@/lib/task/productivity-config";

/**
 * How much got done, counted from the work itself rather than remembered.
 *
 * For the two task types that shadow a module — Claim Follow-up over AR, and
 * Denial/Rejection Work over EOB — the count already exists as an audit trail:
 * every call a biller logs writes a work note stamped with who did it and
 * when. Asking them to also type "I did 14" produces a second number that can
 * disagree with the first, and the typed one is the one that reaches the
 * analytics.
 *
 * So the count is the intersection of two things the system already knows:
 * **the sessions their timer recorded**, and **the notes they wrote inside
 * those sessions**. Work done off the clock is not counted, which is the point
 * — the report divides one by the other.
 *
 * Which task types this applies to is decided by
 * [productivity-config.ts](lib/task/productivity-config.ts) via
 * `autoSourceModule`, so the list lives in one place and the UI that says
 * "auto-calculated" and the code that calculates it cannot drift.
 */

export interface AutoLinkedProductivity {
  /** Null when this task type is counted by hand. */
  count: number | null;
  amount: Prisma.Decimal | null;
  source: "AR" | "EOB" | null;
  /** The window actually counted, so the close screen can show it. */
  from: Date | null;
  to: Date | null;
  sessionCount: number;
}

const NOTHING: AutoLinkedProductivity = {
  count: null,
  amount: null,
  source: null,
  from: null,
  to: null,
  sessionCount: 0,
};

export async function autoLinkProductivity(
  taskId: string,
  userId: string,
): Promise<AutoLinkedProductivity> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      practiceId: true,
      taskType: { select: { name: true } },
    },
  });

  if (!task) return NOTHING;

  const source = productivityConfigFor(task.taskType?.name)?.autoSourceModule;

  // Every other task type is entered by hand, exactly as before.
  if (!source) return NOTHING;

  const sessions = await prisma.taskTimeLog.findMany({
    where: { taskId, userId, stoppedAt: { not: null } },
    orderBy: { startedAt: "asc" },
    select: { startedAt: true, stoppedAt: true },
  });

  /**
   * No timer, no window to count in. Zero rather than null: the task type is
   * auto-counted, and reporting "unknown" would put it back in the hands of
   * whoever is typing.
   */
  if (sessions.length === 0) {
    return {
      count: 0,
      amount: source === "EOB" ? new Prisma.Decimal(0) : null,
      source,
      from: null,
      to: null,
      sessionCount: 0,
    };
  }

  const windows = sessions.map((session) => ({
    gte: session.startedAt,
    lte: session.stoppedAt as Date,
  }));

  const from = sessions[0]!.startedAt;
  const to = sessions.reduce(
    (latest, session) =>
      (session.stoppedAt as Date) > latest ? (session.stoppedAt as Date) : latest,
    sessions[0]!.stoppedAt as Date,
  );

  /**
   * A note counts when it falls inside **any** session — the timer is stopped
   * and started through a day, so the windows are a set of intervals rather
   * than one span. Written as an OR of ranges so the database does the work in
   * one query, however many sessions there were.
   */
  if (source === "AR") {
    const count = await prisma.arWorkNote.count({
      where: {
        workedById: userId,
        OR: windows.map((window) => ({ workedAt: window })),
        // A task pinned to a practice counts only that practice's work; a
        // general task counts whatever they did in the window.
        ...(task.practiceId
          ? { claim: { batch: { practiceId: task.practiceId } } }
          : {}),
      },
    });

    // An AR follow-up has no dollar figure of its own — the balance belongs to
    // the claim, not to the act of chasing it, and summing balances would
    // count the same money on every call.
    return { count, amount: null, source, from, to, sessionCount: sessions.length };
  }

  const notes = await prisma.eobWorkNote.findMany({
    where: {
      workedById: userId,
      OR: windows.map((window) => ({ workedAt: window })),
      ...(task.practiceId
        ? { entry: { batch: { practiceId: task.practiceId } } }
        : {}),
    },
    select: { entry: { select: { deniedAmount: true } } },
  });

  /**
   * Decimal arithmetic, never a float: these are dollars, and the total is
   * reported beside the count.
   */
  const amount = notes.reduce(
    (sum, note) => sum.add(note.entry.deniedAmount ?? 0),
    new Prisma.Decimal(0),
  );

  return {
    count: notes.length,
    amount,
    source,
    from,
    to,
    sessionCount: sessions.length,
  };
}
