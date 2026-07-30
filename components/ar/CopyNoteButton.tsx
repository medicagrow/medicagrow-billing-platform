"use client";

import { useEffect, useState } from "react";
import { CheckIcon, ClipboardIcon } from "@/components/ui/icons";

const REVERT_AFTER_MS = 2000;

/**
 * Copies a saved work note so the biller can paste it straight into the EHR.
 * Copies the generated text plus any additional notes, matching what the work
 * log displays.
 */
export function CopyNoteButton({
  text,
  additionalNotes,
}: {
  text: string;
  additionalNotes?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied && !failed) return;

    const timer = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, REVERT_AFTER_MS);

    return () => clearTimeout(timer);
  }, [copied, failed]);

  async function handleCopy() {
    const full = additionalNotes?.trim()
      ? `${text}\n\n${additionalNotes.trim()}`
      : text;

    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
    } catch {
      // Clipboard access is denied outside a secure context.
      setFailed(true);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={
        failed
          ? "Clipboard unavailable — select and copy manually"
          : "Copy note to clipboard"
      }
      aria-label="Copy note to clipboard"
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors ${
        copied
          ? "text-emerald-600"
          : failed
            ? "text-red-600"
            : "text-slate-400 hover:bg-white hover:text-slate-700"
      }`}
    >
      {copied ? (
        <>
          <CheckIcon className="h-3.5 w-3.5" />
          Copied!
        </>
      ) : failed ? (
        "Copy failed"
      ) : (
        <ClipboardIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
