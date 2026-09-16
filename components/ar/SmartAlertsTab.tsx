"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import {
  type AlertCategory,
  type AlertSeverity,
  type SmartAlert,
} from "@/lib/ar/batch-insights-shared";
import { formatUSD } from "@/lib/format";

const CATEGORY_ICON: Record<AlertCategory, string> = {
  TIMELY_FILING: "⏰",
  PACE: "📉",
  QUALITY: "🔁",
  FINANCIAL: "💰",
  BILLER: "👤",
};

const SEVERITY_STYLE: Record<
  AlertSeverity,
  { card: string; badge: string; heading: string }
> = {
  HIGH: {
    card: "border-red-200",
    badge: "bg-red-100 text-red-800 ring-red-200",
    heading: "text-red-700",
  },
  MEDIUM: {
    card: "border-amber-200",
    badge: "bg-amber-100 text-amber-800 ring-amber-200",
    heading: "text-amber-700",
  },
  LOW: {
    card: "border-slate-200",
    badge: "bg-slate-100 text-slate-700 ring-slate-200",
    heading: "text-slate-600",
  },
};

const SEVERITIES: AlertSeverity[] = ["HIGH", "MEDIUM", "LOW"];

/**
 * What in this batch needs looking at today.
 *
 * Alerts are recomputed on every load, so dismissing one only hides it for
 * this visit: if the claims are still idle tomorrow, the alert is still true
 * tomorrow. Each card's "view affected claims" lands on the All Claims tab
 * filtered to exactly the claims the alert counted.
 */
export function SmartAlertsTab({
  alerts,
  loading,
  error,
  onViewClaims,
  onRefresh,
}: {
  alerts: SmartAlert[] | null;
  loading: boolean;
  error: string | null;
  onViewClaims: (alert: SmartAlert) => void;
  onRefresh: () => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (loading && !alerts) {
    return <div className="h-32 animate-pulse rounded-xl bg-slate-100" />;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
        <button type="button" onClick={onRefresh} className="ml-2 font-medium underline">
          Retry
        </button>
      </div>
    );
  }

  const visible = (alerts ?? []).filter((alert) => !dismissed.has(alert.id));
  const high = visible.filter((alert) => alert.severity === "HIGH").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-slate-900">
            {visible.length} active alert{visible.length === 1 ? "" : "s"}
          </span>
          {" — "}
          <span className={high > 0 ? "font-semibold text-red-700" : ""}>
            {high} high priority
          </span>
          <span className="ml-2 text-xs text-slate-500">
            Claims aged 30 days or less are never counted.
          </span>
        </p>
        <div className="flex items-center gap-2">
          {dismissed.size > 0 ? (
            <button
              type="button"
              onClick={() => setDismissed(new Set())}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Show {dismissed.size} dismissed
            </button>
          ) : null}
          <Button
            variant="secondary"
            onClick={onRefresh}
            disabled={loading}
            className="px-3 py-1.5 text-xs"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing needs attention"
          description="No timely filing risks, idle high balances, denial patterns or pace problems in this batch right now."
        />
      ) : (
        SEVERITIES.map((severity) => {
          const group = visible.filter((alert) => alert.severity === severity);
          if (group.length === 0) return null;

          const style = SEVERITY_STYLE[severity];

          return (
            <section key={severity} className="space-y-3">
              <h3
                className={`text-xs font-semibold uppercase tracking-wide ${style.heading}`}
              >
                {severity === "HIGH"
                  ? "High priority"
                  : severity === "MEDIUM"
                    ? "Medium"
                    : "Low"}
              </h3>

              {group.map((alert) => (
                <article
                  key={alert.id}
                  className={`rounded-xl border bg-white p-4 shadow-card ${style.card}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-lg leading-none" aria-hidden>
                      {CATEGORY_ICON[alert.category]}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${style.badge}`}
                        >
                          {alert.severity}
                        </span>
                        <h4 className="font-semibold text-slate-900">
                          {alert.title}
                        </h4>
                      </div>

                      <p className="mt-1 text-sm text-slate-600">
                        {alert.description}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium tabular-nums text-slate-700">
                          {alert.affectedCount.toLocaleString()} claim
                          {alert.affectedCount === 1 ? "" : "s"} ·{" "}
                          {formatUSD(alert.affectedBalance)} balance
                        </span>

                        {alert.affectedCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => onViewClaims(alert)}
                            className="text-xs font-medium text-brand-700 hover:text-brand-800"
                          >
                            View affected claims →
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setDismissed((current) => new Set(current).add(alert.id))
                      }
                      className="text-xs text-slate-400 hover:text-slate-700"
                      title="Hide until the page is reloaded"
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}
