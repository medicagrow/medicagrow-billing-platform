"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";

/**
 * How much room each biller has, beside the control that fills it.
 *
 * A PM assigning a batch is making a capacity decision, and until now the only
 * information on screen was a list of names. The number that actually decides
 * it is **net available** — free hours minus what other practices' AR has
 * already booked — because a biller can look idle in this PM's world and be
 * fully committed in somebody else's.
 */

interface ArCommitment {
  practiceId: string;
  practiceName: string;
  pmName: string | null;
  dailyHours: number;
  totalHours: number;
}

interface CapacityRow {
  userId: string;
  userName: string;
  freeHours: number;
  arCommitted: ArCommitment[];
  netAvailableHours: number;
  avgMinutesPerClaim: number | null;
  estimatedClaimsCapacity: number | null;
  isTeamRate: boolean;
  unconfiguredArTasks: number;
}

interface CapacityResponse {
  from: string;
  to: string;
  workingDays: number;
  hoursPerDay: number;
  billers: CapacityRow[];
}

export function BillerCapacityPanel({ batchId }: { batchId: string }) {
  const [data, setData] = useState<CapacityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const response = await fetch(
          `/api/ar/batches/${batchId}/biller-capacity`,
        );

        const payload = await response.json().catch(() => null);

        if (!live) return;

        if (!response.ok) {
          setError(payload?.error ?? "Could not load biller capacity.");
          return;
        }

        setData(payload);
      } catch {
        if (live) setError("Could not load biller capacity.");
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [batchId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500 shadow-card">
        Working out who has room…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
        {error}
      </div>
    );
  }

  if (!data || data.billers.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">
          Biller capacity
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          {formatDate(data.from)} – {formatDate(data.to)} · {data.workingDays}{" "}
          working days at {data.hoursPerDay}h. AR commitments count every
          practice, not just this one.
        </p>
      </div>

      <ul className="divide-y divide-slate-100">
        {data.billers.map((biller) => (
          <li key={biller.userId} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-slate-900">{biller.userName}</p>
              <p
                className={`text-sm font-semibold tabular-nums ${
                  biller.netAvailableHours <= 0
                    ? "text-red-700"
                    : biller.netAvailableHours < 8
                      ? "text-amber-700"
                      : "text-emerald-700"
                }`}
              >
                {biller.netAvailableHours}h available
              </p>
            </div>

            <dl className="mt-1.5 space-y-0.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Free hours</dt>
                <dd className="tabular-nums text-slate-700">
                  {biller.freeHours}h
                </dd>
              </div>

              {biller.arCommitted.map((commitment) => (
                <div
                  key={commitment.practiceId || commitment.practiceName}
                  className="flex justify-between gap-3"
                >
                  <dt className="text-slate-500">
                    AR committed ({commitment.practiceName})
                    {commitment.pmName ? (
                      <span className="text-slate-400">
                        {" "}
                        — PM: {commitment.pmName}
                      </span>
                    ) : null}
                  </dt>
                  <dd className="whitespace-nowrap tabular-nums text-slate-700">
                    −{commitment.totalHours}h
                    <span className="text-slate-400">
                      {" "}
                      ({commitment.dailyHours}h/day)
                    </span>
                  </dd>
                </div>
              ))}

              <div className="flex justify-between gap-3 border-t border-slate-100 pt-0.5">
                <dt className="font-medium text-slate-600">Net available</dt>
                <dd className="font-medium tabular-nums text-slate-900">
                  {biller.netAvailableHours}h
                </dd>
              </div>

              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Est. capacity</dt>
                <dd className="tabular-nums text-slate-700">
                  {biller.estimatedClaimsCapacity === null ? (
                    // No closed AR anywhere yet — better to say so than to
                    // quote a number nothing supports.
                    <span className="text-slate-400">no history yet</span>
                  ) : (
                    <>
                      ~{biller.estimatedClaimsCapacity} claims
                      <span className="text-slate-400">
                        {" "}
                        (at {biller.avgMinutesPerClaim}m each
                        {biller.isTeamRate ? ", team average" : ""})
                      </span>
                    </>
                  )}
                </dd>
              </div>
            </dl>

            {/*
              Their AR commitment is understated by however many tasks have no
              daily hours, so the headline above is optimistic. Saying so beats
              letting somebody plan against it.
            */}
            {biller.unconfiguredArTasks > 0 ? (
              <p className="mt-1.5">
                <Badge variant="amber">
                  AR commitment unknown — {biller.unconfiguredArTasks} task
                  {biller.unconfiguredArTasks === 1 ? "" : "s"} not configured
                </Badge>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
