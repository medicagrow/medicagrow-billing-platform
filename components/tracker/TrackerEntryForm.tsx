"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ScoreCell } from "@/components/tracker/ScoreCell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { FieldError, Label } from "@/components/ui/Input";
import { NumericInput } from "@/components/ui/inputs/NumericInput";
import { PercentInput } from "@/components/ui/inputs/PercentInput";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import { formatUSD } from "@/lib/format";
import {
  DEFAULT_CONFIG,
  type TrackerConfig,
} from "@/lib/tracker/config-defaults";
import {
  calculateScores,
  SCORE_KEYS,
  SCORE_LABELS,
  weightsByScoreKey,
  type ScoreKey,
} from "@/lib/tracker/scoring";

/** Form values are strings — a blank field means "no data", not zero. */
export type TrackerFormValues = Record<string, string>;

type TabKey =
  | "volume"
  | "financial"
  | "pipeline"
  | "denials"
  | "aging"
  | "followup"
  | "eligibility"
  | "compliance"
  | "team"
  | "summary";

const TABS: { key: TabKey; label: string }[] = [
  { key: "volume", label: "Volume" },
  { key: "financial", label: "Financial" },
  { key: "pipeline", label: "Billing Pipeline" },
  { key: "denials", label: "Rejections & Denials" },
  { key: "aging", label: "AR Aging" },
  { key: "followup", label: "Follow-up" },
  { key: "eligibility", label: "Eligibility" },
  { key: "compliance", label: "Compliance Setup" },
  { key: "team", label: "Team & Management" },
  { key: "summary", label: "Score Summary" },
];

const num = (value: string | undefined) => {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value.replace(/[$,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const percentOrDash = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;

/** Percentage fields are entered 0–100 and scored as 0–1. */
const pct = (value: string | undefined) => {
  const parsed = num(value);
  return parsed === null ? null : Math.min(1, Math.max(0, parsed / 100));
};

/**
 * What a field accepts:
 *   count   — whole numbers only (appointments, claims, pending items, AR counts)
 *   money   — dollars, two decimals, held as a string
 *   ratio   — a decimal quantity that is not money, such as 1.5 resources
 *   percent — 0–100 with a % suffix; stored 0–1
 */
type FieldKind = "count" | "money" | "ratio" | "percent";

function Field({
  label,
  name,
  values,
  onChange,
  disabled,
  hint,
  kind = "count",
}: {
  label: string;
  name: string;
  values: TrackerFormValues;
  onChange: (name: string, value: string) => void;
  disabled: boolean;
  hint?: string;
  kind?: FieldKind;
}) {
  const value = values[name] ?? "";
  const shared = { id: name, disabled, placeholder: "—" };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>

      {kind === "count" ? (
        <NumericInput
          {...shared}
          value={value}
          onChange={(next) => onChange(name, next)}
        />
      ) : kind === "percent" ? (
        <PercentInput
          {...shared}
          value={value}
          onChange={(next) => onChange(name, next)}
        />
      ) : (
        <DecimalInput
          {...shared}
          prefix={kind === "money" ? "$" : null}
          value={value}
          onChange={(next) => onChange(name, next)}
        />
      )}

      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Derived({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
        {value}
      </p>
    </div>
  );
}

/**
 * A calculated rate with an owner-only manual override.
 *
 * The calculated figure is always shown. Turning the override on reveals a
 * percent input that replaces it for scoring; clearing the input reverts to the
 * calculated value, so an override is never silently sticky.
 */
function RateField({
  label,
  hint,
  name,
  calculated,
  values,
  onChange,
  disabled,
  canOverride,
}: {
  label: string;
  hint: string;
  name: string;
  calculated: number | null;
  values: TrackerFormValues;
  onChange: (name: string, value: string) => void;
  disabled: boolean;
  canOverride: boolean;
}) {
  const manual = values[name] ?? "";
  const [open, setOpen] = useState(manual !== "");

  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        {manual !== "" ? <Badge variant="amber">Manual override</Badge> : null}
      </div>

      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
        {percentOrDash(calculated)}
        {manual !== "" ? (
          <span className="ml-2 text-xs font-normal text-slate-500">
            calculated
          </span>
        ) : null}
      </p>

      <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>

      {canOverride && !disabled ? (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={open}
              onChange={(event) => {
                setOpen(event.target.checked);
                // Turning it off reverts to the calculated value.
                if (!event.target.checked) onChange(name, "");
              }}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            Override manually
          </label>

          {open ? (
            <div className="mt-2">
              <PercentInput
                id={name}
                value={manual}
                onChange={(next) => onChange(name, next)}
                placeholder="—"
                aria-label={`${label} manual override`}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScoreHint({ score, label }: { score: number | null; label: string }) {
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
      <span className="text-xs text-slate-500">{label}</span>
      <ScoreCell score={score} />
    </div>
  );
}

const AUTO_POPULATE_NOTE =
  "These numbers will auto-populate from the module in a future update.";

export function TrackerEntryForm({
  practiceId,
  practiceName,
  monthYear,
  initialValues,
  entryId,
  locked,
  lockedAt,
  lockedByName,
  canLock,
  canEdit,
  canOverride,
  config = DEFAULT_CONFIG,
}: {
  practiceId: string;
  practiceName: string;
  monthYear: string;
  initialValues: TrackerFormValues;
  entryId: string | null;
  locked: boolean;
  lockedAt: string | null;
  lockedByName: string | null;
  canLock: boolean;
  canEdit: boolean;
  /** Manual rate overrides are an owner-only escape hatch. */
  canOverride: boolean;
  config?: TrackerConfig;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>("volume");
  const [values, setValues] = useState<TrackerFormValues>(initialValues);
  const [saving, setSaving] = useState<TabKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [locking, setLocking] = useState(false);

  const disabled = locked || !canEdit;

  const set = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  // Live preview using the same function the server saves with, so what the
  // PM sees while typing is what gets stored.
  const scores = useMemo(
    () =>
      calculateScores({
        totalPayments: num(values.totalPayments),
        totalAdjustments: num(values.totalAdjustments),
        totalCharges: num(values.totalCharges),
        totalClaims: num(values.totalClaims),
        pendingClaimsToBill: num(values.pendingClaimsToBill),
        pendingEraToPost: num(values.pendingEraToPost),
        pendingPatientPaymentsToPost: num(values.pendingPatientPaymentsToPost),
        rejectionsReceived: num(values.rejectionsReceived),
        outstandingRejections: num(values.outstandingRejections),
        eobDenialsReceived: num(values.eobDenialsReceived),
        outstandingEobDenials: num(values.outstandingEobDenials),
        arAmount0to30: num(values.arAmount0to30),
        arAmount31to60: num(values.arAmount31to60),
        arAmount61to90: num(values.arAmount61to90),
        arAmount90plus: num(values.arAmount90plus),
        followUpCompliance: pct(values.followUpCompliance),
        totalAppointmentsForElig: num(values.totalAppointmentsForElig),
        eligibilityCompleted: num(values.eligibilityCompleted),
        eftEnrollment: pct(values.eftEnrollment),
        eraEnrollment: pct(values.eraEnrollment),
        portalAccess: pct(values.portalAccess),
        feeSchedule: pct(values.feeSchedule),
        sopCompliance: pct(values.sopCompliance),
        resourcesAssigned: num(values.resourcesAssigned),
        monthlyReviewMeeting:
          values.monthlyReviewMeeting === ""
            ? null
            : values.monthlyReviewMeeting === "true",
        directClientCommunication: values.directClientCommunication || null,
        netCollectionRateManual: pct(values.netCollectionRateManual),
        paymentEfficiencyManual: pct(values.paymentEfficiencyManual),
      }, config),
    [values, config],
  );

  const baseWeights = useMemo(
    () => weightsByScoreKey(config.weights),
    [config],
  );

  async function save(which: Exclude<TabKey, "summary">) {
    setError(null);
    setSaving(which);

    try {
      // The whole record is sent so the server can recompute every score;
      // partial payloads would recalculate against missing inputs.
      const response = await fetch("/api/tracker/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practiceId,
          monthYear,
          ...Object.fromEntries(
            Object.entries(values).map(([key, value]) => [
              key,
              value === "" ? null : value,
            ]),
          ),
          monthlyReviewMeeting:
            values.monthlyReviewMeeting === ""
              ? null
              : values.monthlyReviewMeeting === "true",
          directClientCommunication: values.directClientCommunication || null,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not save.");
        return;
      }

      toast(`${TABS.find((entry) => entry.key === which)?.label} saved`);
      router.refresh();
    } catch {
      setError("Could not save. Check your connection.");
    } finally {
      setSaving(null);
    }
  }

  async function handleLock() {
    if (!entryId) return;
    setLocking(true);

    try {
      const response = await fetch(`/api/tracker/entries/${entryId}/lock`, {
        method: "PATCH",
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast(payload?.error ?? "Could not lock the entry.", "error");
        return;
      }

      toast("Entry locked");
      setLockOpen(false);
      router.refresh();
    } catch {
      toast("Could not lock the entry.", "error");
    } finally {
      setLocking(false);
    }
  }

  const SaveButton = ({ which }: { which: Exclude<TabKey, "summary"> }) =>
    disabled ? null : (
      <div className="mt-4 flex justify-end">
        <Button onClick={() => save(which)} disabled={saving !== null}>
          {saving === which ? "Saving…" : "Save"}
        </Button>
      </div>
    );

  return (
    <div>
      {locked ? (
        <div className="mb-4 rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
          This entry was locked{lockedAt ? ` on ${lockedAt}` : ""}
          {lockedByName ? ` by ${lockedByName}` : ""}. It can no longer be
          edited.
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-slate-200">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === entry.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-4">
          <FieldError>{error}</FieldError>
        </p>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        {tab === "volume" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Total appointments" name="totalAppointments" values={values} onChange={set} disabled={disabled} />
              <Field label="Total visits" name="totalVisits" values={values} onChange={set} disabled={disabled} />
              <Field label="Total claims" name="totalClaims" values={values} onChange={set} disabled={disabled} />
            </div>
            <SaveButton which="volume" />
          </>
        ) : null}

        {tab === "financial" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Total charges" name="totalCharges" values={values} onChange={set} disabled={disabled} kind="money" />
              <Field label="Total payments" name="totalPayments" values={values} onChange={set} disabled={disabled} kind="money" />
              <Field label="Total adjustments" name="totalAdjustments" values={values} onChange={set} disabled={disabled} kind="money" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <RateField
                label="Net collection rate"
                hint="(payments + adjustments) ÷ charges"
                name="netCollectionRateManual"
                calculated={scores.netCollectionRate}
                values={values}
                onChange={set}
                disabled={disabled}
                canOverride={canOverride}
              />
              <RateField
                label="Payment efficiency"
                hint="payments ÷ (payments + adjustments)"
                name="paymentEfficiencyManual"
                calculated={scores.paymentEfficiency}
                values={values}
                onChange={set}
                disabled={disabled}
                canOverride={canOverride}
              />
            </div>
            <ScoreHint score={scores.scoreA} label="Score A — Net Collection Rate" />
            <SaveButton which="financial" />
          </>
        ) : null}

        {tab === "pipeline" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Pending claims to bill" name="pendingClaimsToBill" values={values} onChange={set} disabled={disabled} />
              <Field label="Pending ERA/EOB to post" name="pendingEraToPost" values={values} onChange={set} disabled={disabled} />
              <Field label="Pending patient payments to post" name="pendingPatientPaymentsToPost" values={values} onChange={set} disabled={disabled} />
            </div>
            <ScoreHint score={scores.scoreB} label="Score B — Billing Pipeline" />
            <SaveButton which="pipeline" />
          </>
        ) : null}

        {tab === "denials" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rejections received" name="rejectionsReceived" values={values} onChange={set} disabled={disabled} />
              <Field label="Outstanding rejections" name="outstandingRejections" values={values} onChange={set} disabled={disabled} />
              <Field label="EOB denials received" name="eobDenialsReceived" values={values} onChange={set} disabled={disabled} />
              <Field label="Outstanding EOB denials" name="outstandingEobDenials" values={values} onChange={set} disabled={disabled} />
            </div>
            <div className="mt-4">
              <Derived label="Denial rate" value={percentOrDash(scores.denialRate)} />
            </div>
            <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-inset ring-sky-200">
              {AUTO_POPULATE_NOTE.replace("the module", "the EOB module")}
            </p>
            <ScoreHint score={scores.scoreC} label="Score C — Rejections & Denials" />
            <SaveButton which="denials" />
          </>
        ) : null}

        {tab === "aging" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="0–30 count" name="arCount0to30" values={values} onChange={set} disabled={disabled} />
              <Field label="0–30 amount" name="arAmount0to30" values={values} onChange={set} disabled={disabled} kind="money" />
              <Field label="31–60 count" name="arCount31to60" values={values} onChange={set} disabled={disabled} />
              <Field label="31–60 amount" name="arAmount31to60" values={values} onChange={set} disabled={disabled} kind="money" />
              <Field label="61–90 count" name="arCount61to90" values={values} onChange={set} disabled={disabled} />
              <Field label="61–90 amount" name="arAmount61to90" values={values} onChange={set} disabled={disabled} kind="money" />
              <Field label="90+ count" name="arCount90plus" values={values} onChange={set} disabled={disabled} />
              <Field label="90+ amount" name="arAmount90plus" values={values} onChange={set} disabled={disabled} kind="money" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Derived
                label="Total AR"
                value={scores.totalAr === null ? "—" : formatUSD(scores.totalAr.toFixed(2))}
              />
              <Derived label="% AR over 90 days" value={percentOrDash(scores.arPercentOver90)} />
            </div>
            <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-inset ring-sky-200">
              {AUTO_POPULATE_NOTE.replace("the module", "the AR module")}
            </p>
            <ScoreHint score={scores.scoreD} label="Score D — AR Aging" />
            <SaveButton which="aging" />
          </>
        ) : null}

        {tab === "followup" ? (
          <>
            <div className="max-w-xs">
              <Field
                label="Follow-up compliance"
                name="followUpCompliance"
                values={values}
                onChange={set}
                disabled={disabled}
                hint="Enter 0–100."
                kind="percent"
              />
            </div>
            <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-inset ring-sky-200">
              {AUTO_POPULATE_NOTE.replace("the module", "the AR module")}
            </p>
            <ScoreHint score={scores.scoreE} label="Score E — Follow-up Compliance" />
            <SaveButton which="followup" />
          </>
        ) : null}

        {tab === "eligibility" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Total appointments for eligibility" name="totalAppointmentsForElig" values={values} onChange={set} disabled={disabled} />
              <Field label="Eligibility completed" name="eligibilityCompleted" values={values} onChange={set} disabled={disabled} />
            </div>
            <div className="mt-4">
              <Derived label="Eligibility compliance" value={percentOrDash(scores.eligibilityCompliance)} />
            </div>
            <ScoreHint score={scores.scoreF} label="Score F — Eligibility Compliance" />
            <SaveButton which="eligibility" />
          </>
        ) : null}

        {tab === "compliance" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="EFT enrollment (%)" name="eftEnrollment" values={values} onChange={set} disabled={disabled} kind="percent" />
              <Field label="ERA enrollment (%)" name="eraEnrollment" values={values} onChange={set} disabled={disabled} kind="percent" />
              <Field label="Portal access (%)" name="portalAccess" values={values} onChange={set} disabled={disabled} kind="percent" />
              <Field label="Fee schedule (%)" name="feeSchedule" values={values} onChange={set} disabled={disabled} kind="percent" />
              <Field label="SOP compliance (%)" name="sopCompliance" values={values} onChange={set} disabled={disabled} kind="percent" />
            </div>
            <ScoreHint score={scores.scoreG} label="Score G — Compliance Setup" />
            <SaveButton which="compliance" />
          </>
        ) : null}

        {tab === "team" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Resources assigned"
                name="resourcesAssigned"
                values={values}
                onChange={set}
                disabled={disabled}
                hint="Decimals allowed — 1.5 means a shared resource."
                kind="ratio"
              />
              <div className="space-y-1.5">
                <Label htmlFor="monthlyReviewMeeting">Monthly review meeting</Label>
                <Select
                  id="monthlyReviewMeeting"
                  value={values.monthlyReviewMeeting ?? ""}
                  onChange={(event) => set("monthlyReviewMeeting", event.target.value)}
                  disabled={disabled}
                >
                  <option value="">No data</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="directClientCommunication">Direct client communication</Label>
                <Select
                  id="directClientCommunication"
                  value={values.directClientCommunication ?? ""}
                  onChange={(event) => set("directClientCommunication", event.target.value)}
                  disabled={disabled}
                >
                  <option value="">No data</option>
                  <option value="Yes">Yes</option>
                  <option value="Partial">Partial</option>
                  <option value="No">No</option>
                </Select>
              </div>
            </div>
            <ScoreHint score={scores.scoreH} label="Score H — Team & Management" />
            <SaveButton which="team" />
          </>
        ) : null}

        {tab === "summary" ? (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Final score — {practiceName}, {monthYear}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {scores.missingScores.length === 0
                    ? "All eight measures have data."
                    : `${scores.missingScores.length} measure${scores.missingScores.length === 1 ? "" : "s"} unavailable — their weight is redistributed across the rest.`}
                </p>
              </div>
              <ScoreCell score={scores.finalScore === null ? null : Math.round(scores.finalScore)} size="lg" />
            </div>

            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2">Measure</th>
                  <th className="py-2 text-right">Base weight</th>
                  <th className="py-2 text-right">Effective weight</th>
                  <th className="py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {SCORE_KEYS.map((key) => {
                  const score = scores[key as ScoreKey];
                  const effective = scores.effectiveWeights[key as ScoreKey];

                  return (
                    <tr key={key}>
                      <td className="py-2.5 text-slate-700">
                        {key.replace("score", "")} — {SCORE_LABELS[key]}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-slate-500">
                        {(baseWeights[key] * 100).toFixed(0)}%
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-slate-700">
                        {effective === undefined ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          `${(effective * 100).toFixed(1)}%`
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <ScoreCell score={score} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {canLock && entryId && !locked ? (
              <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
                <Button variant="secondary" onClick={() => setLockOpen(true)}>
                  Lock entry
                </Button>
              </div>
            ) : null}

            {locked ? (
              <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
                Locked{lockedAt ? ` on ${lockedAt}` : ""}
                {lockedByName ? ` by ${lockedByName}` : ""}.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <Modal
        open={lockOpen}
        onClose={() => (locking ? undefined : setLockOpen(false))}
        title="Lock this entry?"
        description="It cannot be edited after locking."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setLockOpen(false)}
              disabled={locking}
            >
              Cancel
            </Button>
            <Button onClick={handleLock} disabled={locking}>
              {locking ? "Locking…" : "Lock entry"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Locking freezes {practiceName} for {monthYear} as a reported figure.
          There is no unlock — reopening a reported month would let history
          change after the fact.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-slate-500">Final score:</span>
          <ScoreCell
            score={scores.finalScore === null ? null : Math.round(scores.finalScore)}
          />
          {scores.missingScores.length > 0 ? (
            <Badge variant="amber">
              {scores.missingScores.length} measure(s) missing
            </Badge>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
