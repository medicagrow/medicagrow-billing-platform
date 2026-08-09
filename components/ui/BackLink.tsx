"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * "← Back to the list", meaning the list you were actually looking at.
 *
 * A hardcoded `href` to the parent page is the thing that quietly undoes
 * filter persistence: the browser's back button restores the query string, but
 * a link to `/ar/batches/123` does not, so anyone who clicks the button on the
 * page instead of the one in the chrome loses every filter.
 *
 * So this goes *back* when there is somewhere in this app to go back to, and
 * falls back to `href` when there is not — arriving from a bookmark, a fresh
 * tab, or an email link.
 */
export function BackLink({
  href,
  children,
  className = "text-sm font-medium text-brand-700 hover:text-brand-800",
}: {
  /** Where to go when there is no history to return to. */
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();

  /**
   * Decided after mount: `window.history` does not exist while rendering on
   * the server, and reading it during render would make the server's HTML and
   * the client's first paint disagree.
   */
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // A fresh tab has a length of 1. Anything more means there is a previous
    // entry, and same-origin referrer means it was ours.
    const sameOrigin =
      document.referrer === "" ||
      document.referrer.startsWith(window.location.origin);

    setCanGoBack(window.history.length > 1 && sameOrigin);
  }, []);

  if (!canGoBack) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => router.back()} className={className}>
      {children}
    </button>
  );
}
