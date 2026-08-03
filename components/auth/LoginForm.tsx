"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { getCsrfToken, signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { SensitiveInput } from "@/components/ui/SensitiveInput";
import { AlertIcon, SpinnerIcon } from "@/components/ui/icons";

/** NextAuth returns opaque codes; map them to something a user can act on. */
function messageForError(code: string) {
  switch (code) {
    case "CredentialsSignin":
      return "Invalid email or password.";
    case "SessionRequired":
      return "Please sign in to continue.";
    case "AccessDenied":
      return "That account does not have access to this platform.";
    default:
      return `Sign-in failed (${code}). If this persists, contact your administrator.`;
  }
}

/**
 * Only same-origin paths are followed after sign-in. `callbackUrl` arrives from
 * the query string, so an absolute URL there would be an open redirect.
 */
function safePath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  // "//evil.com" is protocol-relative and leaves the origin.
  return value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

/**
 * Where to land after a successful sign-in. NextAuth echoes back an absolute
 * URL; only its path is used, and only when it points at this origin.
 */
function resolveDestination(url: string | null | undefined, fallback: string) {
  if (!url) return fallback;

  try {
    const parsed = new URL(url, window.location.origin);

    if (parsed.origin !== window.location.origin) return fallback;

    return safePath(`${parsed.pathname}${parsed.search}`, fallback);
  } catch {
    return fallback;
  }
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = safePath(searchParams.get("callbackUrl"));

  // NextAuth redirects here with ?error=... when its own flow fails.
  const initialError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    initialError ? messageForError(initialError) : null,
  );
  const [submitting, setSubmitting] = useState(false);

  /**
   * NextAuth mints the CSRF token on the first call to /api/auth/csrf and sets
   * the paired cookie in that response. `signIn()` will fetch it itself, but
   * doing it here means the token and its cookie are already in place when the
   * form is first submitted, rather than being established during the same
   * click that depends on them.
   */
  useEffect(() => {
    getCsrfToken().catch(() => {
      // Nothing to do — signIn() fetches it again and reports the failure.
    });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      // signIn resolves undefined when it cannot reach or parse /api/auth/*.
      // That happens when the dev server is serving a stale build, and it used
      // to fail silently — surface it instead of leaving the form hanging.
      if (!result) {
        setError(
          "Could not reach the authentication server. Restart the dev server and try again.",
        );
        setSubmitting(false);
        return;
      }

      if (result.error) {
        setError(messageForError(result.error));
        setSubmitting(false);
        return;
      }

      /**
       * A full document load, not `router.replace()`.
       *
       * The session cookie has just been set by the sign-in response, and every
       * page behind the shell is server-rendered behind middleware that reads
       * it. A client-side navigation asks the router for an RSC payload while
       * the App Router cache still holds the entry for /login — and pairing it
       * with `router.refresh()` raced two navigations against each other, which
       * is why the first attempt appeared to do nothing and the second worked.
       * Reloading the document makes the server the only thing deciding where
       * the user lands, with the new cookie already attached.
       *
       * `submitting` deliberately stays true: the browser is now navigating,
       * and dropping back to "Sign in" mid-flight reads as a failure.
       */
      window.location.assign(resolveDestination(result.url, callbackUrl));
    } catch (cause) {
      console.error("Sign-in request failed:", cause);
      setError(
        cause instanceof Error
          ? `Sign-in request failed: ${cause.message}`
          : "Sign-in request failed unexpectedly.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@medicagrow.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <SensitiveInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          value={password}
          onChange={setPassword}
          disabled={submitting}
        />
      </div>

      {error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-100"
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? (
          <>
            <SpinnerIcon className="h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>

      {/*
        Signing in takes a few seconds — a cold serverless function, a password
        hash comparison and then a full page load. Saying so keeps the wait
        looking deliberate instead of stuck.
      */}
      {submitting ? (
        <p
          aria-live="polite"
          className="flex items-center justify-center gap-2 text-xs text-slate-500"
        >
          <SpinnerIcon className="h-3 w-3 animate-spin" />
          Checking your credentials and loading your workspace…
        </p>
      ) : null}
    </form>
  );
}
