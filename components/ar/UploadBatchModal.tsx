"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CsvMappingStep,
  type ParsedCsv,
} from "@/components/ar/CsvMappingStep";
import { Button } from "@/components/ui/Button";
import { FieldError, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { usePracticeDefault } from "@/lib/hooks/usePracticeDefault";
import { SpinnerIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { isBlankRow, parseCsv } from "@/lib/ar-parsers/csv";
import {
  autoFieldMapping,
  FIELD_LABELS,
  missingRequiredFields,
  type FieldMapping,
} from "@/lib/ar-parsers/detect";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface PracticeOption {
  id: string;
  name: string;
  hasOpenBatch: boolean;
}

interface RowError {
  row: number;
  field: string;
  message: string;
}

interface UploadSummary {
  batchId: string;
  totalClaims: number;
  totalRows: number;
  failedRows: number;
  errors: RowError[];
  warnings: string[];
}

type Step = "select" | "mapping" | "done";

function downloadErrorReport(errors: RowError[]) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const csv = [
    "row,field,message",
    ...errors.map((error) =>
      [error.row, escape(error.field), escape(error.message)].join(","),
    ),
  ].join("\r\n");

  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );

  const link = document.createElement("a");
  link.href = url;
  link.download = "ar-import-errors.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function UploadBatchModal({
  open,
  onClose,
  practices,
  initialPracticeId,
}: {
  open: boolean;
  onClose: () => void;
  practices: PracticeOption[];
  initialPracticeId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const now = new Date();
  const [step, setStep] = useState<Step>("select");
  // The top-bar practice seeds the picker, but does not lock it: a practice
  // with an open batch cannot be uploaded to, so the choice is not free here.
  const { practiceId: contextPracticeId } = usePracticeDefault();

  const [practiceId, setPracticeId] = useState(
    initialPracticeId ?? contextPracticeId ?? "",
  );
  const [reportMonth, setReportMonth] = useState(String(now.getMonth() + 1));
  const [reportYear, setReportYear] = useState(String(now.getFullYear()));
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<FieldMapping | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep("select");
    setPracticeId(initialPracticeId ?? contextPracticeId ?? "");
    setFile(null);
    setCsv(null);
    setMapping(null);
    setSummary(null);
    setError(null);
    setBusy(false);
  }

  function handleClose() {
    if (busy) return;
    reset();
    onClose();
  }

  /**
   * Step 1 -> 2. Parsed entirely in the browser: the mapping preview needs the
   * rows in memory anyway so it can re-render as the PM changes dropdowns.
   */
  async function handleAnalyse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!practiceId) return setError("Select a practice.");
    if (!file) return setError("Choose the standardised CSV to upload.");
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return setError("Only .csv files are accepted.");
    }

    setBusy(true);

    try {
      const rows = parseCsv(await file.text());

      if (rows.length === 0) {
        setError("That CSV file is empty.");
        return;
      }

      const headers = rows[0]!.map((header) => header.trim());
      const dataRows = rows.slice(1).filter((row) => !isBlankRow(row));

      if (dataRows.length === 0) {
        setError("That CSV has a header row but no data rows.");
        return;
      }

      setCsv({ headers, rows: dataRows });
      setMapping(autoFieldMapping(headers));
      setStep("mapping");
    } catch {
      setError("Could not read that file. Confirm it is a valid CSV.");
    } finally {
      setBusy(false);
    }
  }

  /** Step 2 -> 3: import using the mapping the PM confirmed. */
  async function handleImport() {
    if (!file || !mapping) return;

    const missing = missingRequiredFields(mapping);

    if (missing.length > 0) {
      setError(
        missing
          .map(
            (field) =>
              `Required field ${FIELD_LABELS[field]} is not mapped to a column`,
          )
          .join(". "),
      );
      return;
    }

    setError(null);
    setBusy(true);

    try {
      const formData = new FormData();
      formData.set("practiceId", practiceId);
      formData.set("reportMonth", reportMonth);
      formData.set("reportYear", reportYear);
      formData.set("file", file);
      formData.set("fieldMapping", JSON.stringify(mapping));

      const response = await fetch("/api/ar/batches", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Import failed. Please try again.");
        return;
      }

      setSummary({
        batchId: payload.batch.id,
        totalClaims: payload.totalClaims,
        totalRows: payload.totalRows,
        failedRows: payload.failedRows,
        errors: payload.errors ?? [],
        warnings: payload.warnings ?? [],
      });
      setStep("done");

      toast(
        `Imported ${payload.totalClaims} claim${payload.totalClaims === 1 ? "" : "s"}`,
      );
      router.refresh();
    } catch {
      setError("Import failed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------ step 3 ------------------------------ */
  if (step === "done" && summary) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        title="Import complete"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose}>
              Close
            </Button>
            <Button
              onClick={() => {
                const id = summary.batchId;
                reset();
                onClose();
                router.push(`/ar/batches/${id}`);
              }}
            >
              Open batch
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-slate-900">
            {summary.totalClaims} claim{summary.totalClaims === 1 ? "" : "s"}
          </span>{" "}
          imported successfully.{" "}
          {summary.failedRows > 0 ? (
            <span className="font-semibold text-amber-700">
              {summary.failedRows} row
              {summary.failedRows === 1 ? "" : "s"} had errors.
            </span>
          ) : (
            <span className="text-slate-500">No rows had errors.</span>
          )}
        </p>

        {summary.warnings.length > 0 ? (
          <ul className="mt-3 space-y-1 rounded-lg bg-sky-50 p-3 text-xs text-sky-900 ring-1 ring-inset ring-sky-200">
            {summary.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        ) : null}

        {summary.failedRows > 0 ? (
          <>
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-inset ring-slate-200">
              {summary.errors.slice(0, 10).map((rowError, index) => (
                <li key={index} className="font-mono text-slate-700">
                  Row {rowError.row} · {rowError.field}: {rowError.message}
                </li>
              ))}
              {summary.errors.length > 10 ? (
                <li className="text-slate-500">
                  …and {summary.errors.length - 10} more
                </li>
              ) : null}
            </ul>

            <Button
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => downloadErrorReport(summary.errors)}
            >
              Download error report (CSV)
            </Button>
          </>
        ) : null}
      </Modal>
    );
  }

  /* ------------------------------ step 2 ------------------------------ */
  if (step === "mapping" && csv && mapping) {
    const missing = missingRequiredFields(mapping);

    return (
      <Modal
        open={open}
        onClose={handleClose}
        title="Confirm field mapping"
        description="Change any mapping below — the preview updates as you go."
        wide
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setStep("select")}
              disabled={busy}
            >
              Back
            </Button>
            <Button onClick={handleImport} disabled={busy || missing.length > 0}>
              {busy ? (
                <>
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  Importing…
                </>
              ) : (
                "Import"
              )}
            </Button>
          </>
        }
      >
        <CsvMappingStep csv={csv} mapping={mapping} onChange={setMapping} />

        {error ? (
          <p className="mt-3">
            <FieldError>{error}</FieldError>
          </p>
        ) : null}
      </Modal>
    );
  }

  /* ------------------------------ step 1 ------------------------------ */
  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Upload AR batch"
      description="Upload the standardised CSV. One open batch per practice."
    >
      <form id="upload-batch-form" onSubmit={handleAnalyse} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="practiceId">Practice</Label>
          <Select
            id="practiceId"
            value={practiceId}
            onChange={(event) => setPracticeId(event.target.value)}
            disabled={busy}
          >
            <option value="">Select a practice…</option>
            {practices.map((practice) => (
              <option
                key={practice.id}
                value={practice.id}
                disabled={practice.hasOpenBatch}
              >
                {practice.name}
                {practice.hasOpenBatch ? " — has an open batch" : ""}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="reportMonth">Report month</Label>
            <Select
              id="reportMonth"
              value={reportMonth}
              onChange={(event) => setReportMonth(event.target.value)}
              disabled={busy}
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reportYear">Report year</Label>
            <Select
              id="reportYear"
              value={reportYear}
              onChange={(event) => setReportYear(event.target.value)}
              disabled={busy}
            >
              {[0, 1, 2, 3].map((offset) => {
                const year = now.getFullYear() - offset;
                return (
                  <option key={year} value={year}>
                    {year}
                  </option>
                );
              })}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="file">Standardised CSV</Label>
          <input
            id="file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            disabled={busy}
            className="block w-full rounded-lg text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <p className="text-xs text-slate-500">
            Columns are matched automatically and you can correct any of them on
            the next step.{" "}
            <a
              href="/templates/ar-claims-template.csv"
              download
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              Download template
            </a>
          </p>
        </div>

        {error ? <FieldError>{error}</FieldError> : null}
      </form>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={handleClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" form="upload-batch-form" disabled={busy}>
          {busy ? (
            <>
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              Reading…
            </>
          ) : (
            "Next: check mapping"
          )}
        </Button>
      </div>
    </Modal>
  );
}
