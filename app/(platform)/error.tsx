"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { AlertIcon } from "@/components/ui/icons";

export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Platform error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertIcon className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">
        Something went wrong
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {error.message || "An unexpected error occurred."}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" onClick={() => window.location.assign("/")}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
