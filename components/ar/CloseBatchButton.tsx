"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toast";
import { formatUSD } from "@/lib/format";

export function CloseBatchButton({
  batchId,
  stats,
}: {
  batchId: string;
  stats: {
    totalClaims: number;
    greenCount: number;
    redCount: number;
    blueCount: number;
    unassignedCount: number;
    overdueCount: number;
    totalBalance: string;
    percentGreen: number;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  async function handleClose() {
    setClosing(true);

    try {
      const response = await fetch(`/api/ar/batches/${batchId}/close`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast(payload?.error ?? "Could not close the batch.", "error");
        setClosing(false);
        return;
      }

      toast("Batch closed — the practice can now receive a new upload");
      setOpen(false);
      router.refresh();
    } catch {
      toast("Could not close the batch. Check your connection.", "error");
    } finally {
      setClosing(false);
    }
  }

  const incomplete = stats.redCount + stats.blueCount;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Close Batch
      </Button>

      <Modal
        open={open}
        onClose={() => (closing ? undefined : setOpen(false))}
        title="Close this batch?"
        description="Closed batches are permanently read-only. No further notes or status changes can be made."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={closing}
            >
              Cancel
            </Button>
            <Button onClick={handleClose} disabled={closing}>
              {closing ? "Closing…" : "Close batch"}
            </Button>
          </>
        }
      >
        <dl className="divide-y divide-slate-100 text-sm">
          <div className="flex justify-between py-2">
            <dt className="text-slate-500">Total claims</dt>
            <dd className="font-medium tabular-nums">{stats.totalClaims}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-slate-500">Total balance</dt>
            <dd className="font-medium tabular-nums">
              {formatUSD(stats.totalBalance)}
            </dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-slate-500">Complete (green)</dt>
            <dd className="font-medium tabular-nums text-emerald-700">
              {stats.greenCount} ({stats.percentGreen}%)
            </dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-slate-500">Still red</dt>
            <dd className="font-medium tabular-nums text-red-700">
              {stats.redCount}
            </dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-slate-500">Blocked on practice (blue)</dt>
            <dd className="font-medium tabular-nums text-sky-700">
              {stats.blueCount}
            </dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-slate-500">Unassigned</dt>
            <dd className="font-medium tabular-nums text-amber-700">
              {stats.unassignedCount}
            </dd>
          </div>
        </dl>

        {incomplete > 0 ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
            {incomplete} claim{incomplete === 1 ? " is" : "s are"} still
            outstanding. Closing now leaves {incomplete === 1 ? "it" : "them"}{" "}
            unresolved and permanently locked.
          </p>
        ) : null}
      </Modal>
    </>
  );
}
