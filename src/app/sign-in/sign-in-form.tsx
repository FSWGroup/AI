"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

/**
 * Sign-in form. Renders only the providers that are actually configured, so an
 * unconfigured method is never offered as a dead-end button.
 */
export function SignInForm({
  providers,
  callbackUrl,
}: {
  providers: { password: boolean; magicLink: boolean; microsoft: boolean };
  callbackUrl: string;
}) {
  const [mode, setMode] = useState<"password" | "magic">(
    providers.password ? "password" : "magic",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  const onPasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn("credentials", {
      email: email.trim(),
      password,
      redirect: false,
      callbackUrl,
    });

    if (result?.error) {
      setError("That email and password combination didn't match. Please try again.");
      setSubmitting(false);
      return;
    }

    // Full navigation so the server layout re-resolves the new session.
    window.location.href = result?.url ?? callbackUrl;
  };

  const onMagicSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn("nodemailer", {
      email: email.trim(),
      redirect: false,
      callbackUrl,
    });

    setSubmitting(false);
    if (result?.error) {
      setError("We couldn't send a sign-in link. Check the address and try again.");
      return;
    }
    setMagicSent(true);
  };

  if (magicSent) {
    return (
      <div
        role="status"
        className="mt-6 rounded-md border border-success-100 bg-success-50 px-4 py-4 text-[0.8125rem] text-success-700"
      >
        <p className="font-semibold">Check your email</p>
        <p className="mt-1 leading-relaxed">
          If <span className="font-medium">{email.trim()}</span> belongs to an active FSW Academy
          account, a sign-in link is on its way. The link expires in 24 hours.
        </p>
        <button
          type="button"
          onClick={() => setMagicSent(false)}
          className="mt-2.5 font-medium text-success-900 underline"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      {providers.microsoft && (
        <>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => signIn("microsoft-entra-id", { callbackUrl })}
          >
            <MicrosoftGlyph />
            Continue with Microsoft
          </Button>

          {(providers.password || providers.magicLink) && (
            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--border-subtle)]" />
              <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                or
              </span>
              <span className="h-px flex-1 bg-[var(--border-subtle)]" />
            </div>
          )}
        </>
      )}

      {mode === "password" && providers.password && (
        <form onSubmit={onPasswordSubmit} className="flex flex-col gap-4">
          <Field label="Work email" htmlFor="email" required>
            <Input
              type="email"
              name="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@fswelsford.com"
            />
          </Field>

          <Field label="Password" htmlFor="password" required>
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {error && (
            <p role="alert" className="text-[0.75rem] font-medium text-danger-700">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" loading={submitting} className="w-full">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      )}

      {mode === "magic" && providers.magicLink && (
        <form onSubmit={onMagicSubmit} className="flex flex-col gap-4">
          <Field
            label="Work email"
            htmlFor="magic-email"
            required
            hint="We'll email you a single-use sign-in link."
          >
            <Input
              type="email"
              name="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@fswelsford.com"
            />
          </Field>

          {error && (
            <p role="alert" className="text-[0.75rem] font-medium text-danger-700">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" loading={submitting} className="w-full">
            {submitting ? "Sending…" : "Email me a sign-in link"}
          </Button>
        </form>
      )}

      {providers.password && providers.magicLink && (
        <button
          type="button"
          onClick={() => {
            setMode(mode === "password" ? "magic" : "password");
            setError(null);
          }}
          className="text-center text-[0.8125rem] font-medium text-[var(--brand-secondary)] hover:underline"
        >
          {mode === "password" ? "Email me a sign-in link instead" : "Sign in with a password instead"}
        </button>
      )}
    </div>
  );
}

function MicrosoftGlyph() {
  return (
    <svg viewBox="0 0 21 21" className="h-4 w-4" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
