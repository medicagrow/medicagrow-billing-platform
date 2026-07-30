"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
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

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  // NextAuth redirects here with ?error=... when its own flow fails.
  const initialError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    initialError ? messageForError(initialError) : null,
  );
  const [submitting, setSubmitting] = useState(false);

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
        return;
      }

      if (result.error) {
        setError(messageForError(result.error));
        return;
      }

      router.replace(result.url ?? callbackUrl);
      router.refresh();
    } catch (cause) {
      console.error("Sign-in request failed:", cause);
      setError(
        cause instanceof Error
          ? `Sign-in request failed: ${cause.message}`
          : "Sign-in request failed unexpectedly.",
      );
    } finally {
      // Always clears, so the button can never stick on "Signing in…".
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
    </form>
  );
}
