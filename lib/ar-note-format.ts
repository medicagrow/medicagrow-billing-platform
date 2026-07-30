import { OutcomeType } from "@/lib/generated/prisma/enums";
import { formatUSD } from "@/lib/format";

/**
 * Builds the generated note text for each outcome (build spec §9.1–9.7).
 *
 * Used by both the live preview in the note form and the API on submission —
 * the same function on both sides, so what the biller previews is exactly what
 * is persisted. The API regenerates rather than trusting the client's copy.
 */

export interface NoteFields {
  // Common to every outcome
  claimNumber?: string;
  claimReceivedDate?: string;
  spokeWith?: string;
  refNumber?: string;
  phone?: string;
  howChecked?: string;

  // Paid
  eraDate?: string;
  amountPaid?: string;
  allowedAmount?: string;
  paymentDate?: string;
  copayAmount?: string;
  deductibleAmount?: string;
  paymentType?: string;
  paymentNumber?: string;
  paymentScope?: string;
  bulkTotalAmount?: string;

  // Denied
  denialDate?: string;
  denialCode?: string;
  denialReason?: string;
  denialDetail?: string;
  actionTaken?: string;
  actionDetail?: string;
  appealDeadline?: string;

  // No claim on file / In process
  checkedDate?: string;
  expectedResolution?: string;
  expectedPaymentDate?: string;
  timelyFilingDeadline?: string;
  resubmissionDate?: string;

  // Patient responsibility
  coinsuranceAmount?: string;
  patientBalance?: string;
  statementSentDate?: string;

  // Check with office
  whatIsNeeded?: string;
  urgency?: string;
  neededByDate?: string;

  // Write off
  writeOffAmount?: string;
  writeOffType?: string;
  approvedBy?: string;
  reason?: string;
}

export interface NoteContext {
  /** The claim's stored number, used when the biller leaves the field blank. */
  claimNumber?: string | null;
}

const blank = "____";

const value = (input?: string) => {
  const text = (input ?? "").trim();
  return text === "" ? undefined : text;
};

const money = (input?: string) => {
  const text = value(input);
  return text === undefined ? undefined : formatUSD(text);
};

/**
 * "Sw John Ref#123 Ph#800-456-2583."
 *
 * Parts left empty are omitted, which is also how the How Checked gating
 * surfaces: Portal clears all three, IVR clears Spoke With.
 */
function contactSentence(fields: NoteFields): string {
  const parts: string[] = [];

  if (value(fields.spokeWith)) parts.push(`Sw ${value(fields.spokeWith)}`);
  if (value(fields.refNumber)) parts.push(`Ref#${value(fields.refNumber)}`);
  if (value(fields.phone)) parts.push(`Ph#${value(fields.phone)}`);

  return parts.length > 0 ? `${parts.join(" ")}.` : "";
}

function checkedSentence(fields: NoteFields): string {
  const how = value(fields.howChecked);
  return how ? `Checked on ${how}.` : "";
}

/** The biller's entry wins; otherwise fall back to the claim's stored number. */
function claimPrefix(fields: NoteFields, context: NoteContext): string {
  const claimNumber =
    value(fields.claimNumber) ?? value(context.claimNumber ?? undefined);
  return claimNumber ? `Claim#${claimNumber}, ` : "";
}

function receivedByInsurance(fields: NoteFields): string {
  const date = value(fields.claimReceivedDate);
  return date ? `Received by insurance on ${date}.` : "";
}

/** Joins sentence fragments, dropping empties and collapsing whitespace. */
function join(...parts: (string | undefined)[]): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

export function generateNote(
  outcomeType: OutcomeType,
  fields: NoteFields,
  context: NoteContext = {},
): string {
  const contact = contactSentence(fields);
  const checked = checkedSentence(fields);
  const prefix = claimPrefix(fields, context);
  const received = receivedByInsurance(fields);

  switch (outcomeType) {
    case OutcomeType.PAID: {
      const amount = money(fields.amountPaid) ?? blank;
      const era = value(fields.eraDate) ?? blank;
      const copay = money(fields.copayAmount);
      const allowed = money(fields.allowedAmount);
      const paymentType = value(fields.paymentType) ?? blank;
      const paymentNumber = value(fields.paymentNumber) ?? blank;
      const scope = value(fields.paymentScope) ?? "Single";
      const bulkTotal = money(fields.bulkTotalAmount);
      const paidOn = value(fields.paymentDate);

      const copayClause = copay ? ` with ${copay} Copay` : "";
      const allowedClause = allowed ? ` (allowed ${allowed})` : "";
      const bulkClause = scope === "Bulk" && bulkTotal ? ` of ${bulkTotal}` : "";

      return join(
        `${prefix}${received}`,
        `Received on ${era} and Paid ${amount}${copayClause}${allowedClause} on ${era} via ${paymentType}# ${paymentNumber} as ${scope} payment${bulkClause}.`,
        paidOn ? `Payment dated ${paidOn}.` : undefined,
        contact,
        checked,
      );
    }

    case OutcomeType.DENIED: {
      const era = value(fields.eraDate) ?? blank;
      const denialDate = value(fields.denialDate);
      const denialCode = value(fields.denialCode);
      const denialReason = value(fields.denialReason) ?? blank;
      const denialDetail = value(fields.denialDetail);
      const action = value(fields.actionTaken);
      const actionDetail = value(fields.actionDetail);
      const appealDeadline = value(fields.appealDeadline);

      const actionText =
        action === "Other" && actionDetail ? actionDetail : action;

      return join(
        `${prefix}${received}`,
        `Received on ${era} and Denied for ${denialReason}.`,
        denialDate ? `Denial issued ${denialDate}.` : undefined,
        denialCode ? `Denial code ${denialCode}.` : undefined,
        denialDetail ? `${denialDetail}.` : undefined,
        actionText ? `${actionText}.` : undefined,
        appealDeadline ? `Appeal deadline ${appealDeadline}.` : undefined,
        contact,
        checked,
      );
    }

    case OutcomeType.NO_CLAIM_ON_FILE: {
      const action = value(fields.actionTaken);
      const timelyFiling = value(fields.timelyFilingDeadline);
      const resubmitted = value(fields.resubmissionDate);

      // "Resubmitted" + a resubmission date read as one statement, not two.
      const actionClause = action
        ? resubmitted
          ? `${action} ${resubmitted}.`
          : `${action}.`
        : resubmitted
          ? `Resubmitted ${resubmitted}.`
          : undefined;

      return join(
        `${prefix}No claim on file.`,
        received,
        contact,
        checked,
        actionClause,
        timelyFiling ? `Timely filing deadline ${timelyFiling}.` : undefined,
      );
    }

    case OutcomeType.PATIENT_RESPONSIBILITY: {
      const era = value(fields.eraDate) ?? blank;
      const deductible = money(fields.deductibleAmount);
      const copay = money(fields.copayAmount);
      const coinsurance = money(fields.coinsuranceAmount);
      const patientBalance = money(fields.patientBalance);
      const statementSent = value(fields.statementSentDate);

      const responsibility = [
        deductible ? `${deductible} Deductible` : undefined,
        copay ? `${copay} Copay` : undefined,
        coinsurance ? `${coinsurance} Coinsurance` : undefined,
      ].filter(Boolean);

      const responsibilityClause =
        responsibility.length > 0 ? ` with ${responsibility.join(" / ")}` : "";

      return join(
        `${prefix}${received}`,
        `Received on ${era} and Paid $0.00${responsibilityClause}.`,
        patientBalance ? `Patient balance ${patientBalance}.` : undefined,
        statementSent ? `Statement sent ${statementSent}.` : undefined,
        contact,
        checked,
      );
    }

    case OutcomeType.IN_PROCESS: {
      const date = value(fields.checkedDate) ?? blank;
      const expected = value(fields.expectedResolution);
      const expectedPayment = value(fields.expectedPaymentDate);

      return join(
        `${prefix}${received}`,
        `Checked on ${date} — In Process${expected ? `. Expected: ${expected}` : ""}.`,
        expectedPayment ? `Expected payment ${expectedPayment}.` : undefined,
        contact,
        checked,
      );
    }

    case OutcomeType.CHECK_WITH_OFFICE: {
      const needed = value(fields.whatIsNeeded) ?? blank;
      const urgent = value(fields.urgency) === "Urgent";
      const neededBy = value(fields.neededByDate);

      return join(
        `${prefix}Check with office — ${needed}.`,
        neededBy ? `Needed by ${neededBy}.` : undefined,
        urgent ? "URGENT." : undefined,
        received,
        contact,
        checked,
      );
    }

    case OutcomeType.WRITE_OFF: {
      const amount = money(fields.writeOffAmount) ?? blank;
      const reason = value(fields.reason) ?? blank;
      const writeOffType = value(fields.writeOffType);
      const approvedBy = value(fields.approvedBy);

      return join(
        `${prefix}Write off ${amount} — ${reason}.`,
        writeOffType ? `Type: ${writeOffType}.` : undefined,
        approvedBy ? `Approved by ${approvedBy}.` : undefined,
        received,
        contact,
      );
    }

    case OutcomeType.OTHER:
    default: {
      return (
        join(`${prefix}${received}`.trim(), contact, checked) ||
        "Claim reviewed."
      );
    }
  }
}
