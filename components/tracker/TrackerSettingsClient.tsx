"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldError, Label } from "@/components/ui/Input";
import { NumericInput } from "@/components/ui/inputs/NumericInput";
import { useToast } from "@/components/ui/toast";
import {
  type ScoreBand,
  type ScoreRanges,
  type ScoreWeights,
  type TrackerConfig,
  weightsTotal,
} from "@/lib/tracker/config-defaults";
import { SCORE_DESCRIPTIONS, SCORE_LABELS } from "@/lib/tracker/scoring";

type Tab = "weights" | "ranges";

/** Weight letters paired with the score they drive. */
const WEIGHT_ROWS: { letter: keyof ScoreWeights; scoreKey: keyof typeof SCORE_LABELS }[] = [
  { letter: "A", scoreKey: "scoreA" },
  { letter: "B", scoreKey: "scoreB" },
  { letter: "C", scoreKey: "scoreC" },
  { letter: "D", scoreKey: "scoreD" },
  { letter: "E", scoreKey: "scoreE" },
  { letter: "F", scoreKey: "scoreF" },
  { letter: "G", scoreKey: "scoreG" },
  { letter: "H", scoreKey: "scoreH" },
];

/**
 * Band sections, in the order they are scored. `ascending` describes how the
 * measured value relates to quality: for a rate, more is better, so the lowest
 * band scores worst; for a backlog or a denial rate, less is better.
 */
const RANGE_SECTIONS: {
  key: keyof Omit<ScoreRanges, "H_meeting" | "H_communication">;
  label: string;
  description: string;
  unit: string;
}[] = [
  {
    key: "A",
    label: "Score A — Net Collection Rate",
    description:
      "Share of billed charges resolved by payment or adjustment. Higher is better.",
    unit: "%",
  },
  {
    key: "B",
    label: "Score B — Billing Pipeline",
    description:
      "The largest pending queue: claims to bill, ERAs to post, patient payments to post. Lower is better.",
    unit: "items",
  },
  {
    key: "C_denial",
    label: "Score C — Denial rate",
    description: "EOB denials as a share of total claims. Lower is better.",
    unit: "%",
  },
  {
    key: "C_outstanding",
    label: "Score C — Outstanding rejections & denials",
    description:
      "Unresolved rejections plus unresolved EOB denials. Lower is better.",
    unit: "items",
  },
  {
    key: "D",
    label: "Score D — AR Aging",
    description: "Share of outstanding AR beyond 90 days. Lower is better.",
    unit: "%",
  },
  {
    key: "E",
    label: "Score E — Follow-up Compliance",
    description: "Share of claims followed up on schedule. Higher is better.",
    unit: "%",
  },
  {
    key: "F",
    label: "Score F — Eligibility Compliance",
    description:
      "Share of appointments with eligibility verified in advance. Higher is better.",
    unit: "%",
  },
  {
    key: "G",
    label: "Score G — Compliance Setup",
    description:
      "Average of EFT, ERA, portal access, fee schedule and SOP completeness. Higher is better.",
    unit: "%",
  },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <h2 className="mb-4 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

export function TrackerSettingsClient({
  initialConfig,
}: {
  initialConfig: TrackerConfig;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("weights");
  const [weights, setWeights] = useState<ScoreWeights>(initialConfig.weights);
  const [ranges, setRanges] = useState<ScoreRanges>(initialConfig.ranges);
  const [saving, setSaving] = useState<Tab | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => weightsTotal(weights), [weights]);
  const totalIsValid = Math.abs(total - 100) < 0.001;

  async function save(section: Tab) {
    setError(null);

    if (section === "weights" && !totalIsValid) {
      setError(`Weights total ${total}%. They must total exactly 100%.`);
      return;
    }

    setSaving(section);

    try {
      const response = await fetch("/api/tracker/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          section === "weights" ? { weights } : { ranges },
        ),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not save the configuration.");
        return;
      }

      toast(
        section === "weights" ? "Weights saved" : "Score ranges saved",
        "success",
      );
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  function setBand(
    key: (typeof RANGE_SECTIONS)[number]["key"],
    index: number,
    field: keyof ScoreBand,
    value: string,
  ) {
    setRanges((current) => {
      const bands = current[key].bands.map((band, position) =>
        position === index ? { ...band, [field]: Number(value || 0) } : band,
      );

      return { ...current, [key]: { bands } };
    });
  }

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(
          [
            { key: "weights", label: "Weights" },
            { key: "ranges", label: "Score Ranges" },
          ] as { key: Tab; label: string }[]
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === item.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-4">
          <FieldError>{error}</FieldError>
        </p>
      ) : null}

      {tab === "weights" ? (
        <Section title="How much each measure contributes to the final score">
          <div className="space-y-3">
            {WEIGHT_ROWS.map(({ letter, scoreKey }) => (
              <div
                key={letter}
                className="grid items-center gap-3 sm:grid-cols-[1fr_120px]"
              >
                <div>
                  <Label htmlFor={`weight-${letter}`}>
                    {letter} — {SCORE_LABELS[scoreKey]}
                  </Label>
                  <p className="text-xs text-slate-500">
                    {SCORE_DESCRIPTIONS[scoreKey]}
                  </p>
                </div>
                <div className="relative">
                  <NumericInput
                    id={`weight-${letter}`}
                    maxLength={3}
                    value={String(weights[letter])}
                    onChange={(next) =>
                      setWeights((current) => ({
                        ...current,
                        [letter]: Number(next || 0),
                      }))
                    }
                    className="pr-8"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-center text-sm text-slate-400">
                    %
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Total</span>
              <span
                className={`font-semibold tabular-nums ${
                  totalIsValid ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {total}%
              </span>
              {totalIsValid ? (
                <Badge variant="brand">Valid</Badge>
              ) : (
                <Badge variant="red">Must total 100%</Badge>
              )}
            </div>

            <Button
              onClick={() => save("weights")}
              disabled={saving !== null || !totalIsValid}
            >
              {saving === "weights" ? "Saving…" : "Save weights"}
            </Button>
          </div>
        </Section>
      ) : null}

      {tab === "ranges" ? (
        <div className="space-y-4">
          {RANGE_SECTIONS.map((section) => (
            <Section key={section.key} title={section.label}>
              <p className="-mt-2 mb-3 text-xs text-slate-500">
                {section.description} Each row reads &ldquo;value up to and
                including this bound scores this many points&rdquo;; the last
                row is the catch-all.
              </p>

              <div className="space-y-2">
                {ranges[section.key].bands.map((band, index) => (
                  <div
                    key={index}
                    className="grid items-center gap-2 sm:grid-cols-[80px_1fr_1fr]"
                  >
                    <span className="text-xs text-slate-500">
                      Band {index + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="w-16 text-xs text-slate-500">Up to</span>
                      <NumericInput
                        maxLength={6}
                        value={String(band.max)}
                        onChange={(next) =>
                          setBand(section.key, index, "max", next)
                        }
                        aria-label={`${section.label} band ${index + 1} upper bound`}
                      />
                      <span className="text-xs text-slate-400">
                        {section.unit}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-16 text-xs text-slate-500">Scores</span>
                      <NumericInput
                        maxLength={3}
                        value={String(band.score)}
                        onChange={(next) =>
                          setBand(section.key, index, "score", next)
                        }
                        aria-label={`${section.label} band ${index + 1} score`}
                      />
                      <span className="text-xs text-slate-400">pts</span>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ))}

          <Section title="Score H — direct mapping">
            <p className="-mt-2 mb-3 text-xs text-slate-500">
              Score H has no bands — each answer maps straight to a score.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Monthly review meeting
                </p>
                {(["yes", "no"] as const).map((option) => (
                  <div key={option} className="flex items-center gap-2">
                    <span className="w-16 text-sm capitalize text-slate-600">
                      {option}
                    </span>
                    <NumericInput
                      maxLength={3}
                      value={String(ranges.H_meeting[option])}
                      onChange={(next) =>
                        setRanges((current) => ({
                          ...current,
                          H_meeting: {
                            ...current.H_meeting,
                            [option]: Number(next || 0),
                          },
                        }))
                      }
                      aria-label={`Monthly review meeting ${option}`}
                    />
                    <span className="text-xs text-slate-400">pts</span>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Direct client communication
                </p>
                {(["Yes", "Partial", "No"] as const).map((option) => (
                  <div key={option} className="flex items-center gap-2">
                    <span className="w-16 text-sm text-slate-600">{option}</span>
                    <NumericInput
                      maxLength={3}
                      value={String(ranges.H_communication[option])}
                      onChange={(next) =>
                        setRanges((current) => ({
                          ...current,
                          H_communication: {
                            ...current.H_communication,
                            [option]: Number(next || 0),
                          },
                        }))
                      }
                      aria-label={`Direct client communication ${option}`}
                    />
                    <span className="text-xs text-slate-400">pts</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <div className="flex justify-end">
            <Button onClick={() => save("ranges")} disabled={saving !== null}>
              {saving === "ranges" ? "Saving…" : "Save score ranges"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
