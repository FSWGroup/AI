import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import {
  isMagicLinkEnabled,
  isMicrosoftSsoEnabled,
  isPasswordAuthEnabled,
} from "@/lib/auth/config";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { FswMark } from "@/components/icons";

export const metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "That email and password combination didn't match. Please try again.",
  AccessDenied:
    "This account doesn't have access to FSW Academy. Contact your administrator if you believe this is a mistake.",
  Verification: "That sign-in link has expired or was already used. Request a new one below.",
  Configuration:
    "Sign-in is not fully configured. Contact your administrator — no authentication provider is enabled.",
  Default: "Something went wrong signing you in. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const actor = await getActor();
  if (actor) redirect("/home");

  const params = await searchParams;
  const settings = await getSettings();
  const error = params.error ? (ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.Default) : null;

  const providers = {
    password: isPasswordAuthEnabled(),
    magicLink: isMagicLinkEnabled(),
    microsoft: isMicrosoftSsoEnabled(),
  };

  const noProviders = !providers.password && !providers.magicLink && !providers.microsoft;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel — industrial navy, no gradient. */}
      <div className="relative flex shrink-0 flex-col justify-between overflow-hidden bg-navy-900 px-8 py-10 lg:w-[46%] lg:px-14 lg:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <FswMark appName={settings.brand.appName} />

        <div className="relative mt-10 lg:mt-0">
          <h2 className="max-w-md text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-white lg:text-[2.125rem]">
            Everything you need to know, in one place.
          </h2>
          <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-navy-200">
            Procedures, training, and answers for the {settings.brand.companyName} team — written
            down once, kept current, and searchable the moment you need it.
          </p>

          <dl className="mt-8 grid max-w-md grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {[
              ["Standard procedures", "The approved way we do the work"],
              ["Role-based training", "Only what your job actually needs"],
              ["Ask FSW AI", "Answers with a source you can open"],
              ["Proof of completion", "Records that hold up to an audit"],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="text-[0.8125rem] font-semibold text-white">{term}</dt>
                <dd className="mt-0.5 text-[0.75rem] leading-relaxed text-navy-300">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative mt-10 text-[0.6875rem] text-navy-400 lg:mt-0">
          © {new Date().getFullYear()} {settings.brand.companyName}. Internal use only.
        </p>
      </div>

      {/* Sign-in panel */}
      <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">Sign in</h1>
          <p className="mt-1.5 text-[0.875rem] text-[var(--text-muted)]">
            Use your {settings.brand.companyName} work account.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-md border border-danger-100 bg-danger-50 px-3.5 py-3 text-[0.8125rem] text-danger-700"
            >
              {error}
            </div>
          )}

          {noProviders ? (
            <div
              role="alert"
              className="mt-6 rounded-md border border-warning-100 bg-warning-50 px-3.5 py-3 text-[0.8125rem] text-warning-700"
            >
              No sign-in method is configured. Set <code>AUTH_ENABLE_PASSWORD</code>,{" "}
              <code>EMAIL_SERVER_HOST</code>, or the Microsoft Entra ID variables, then restart the
              application.
            </div>
          ) : (
            <SignInForm providers={providers} callbackUrl={params.callbackUrl ?? "/home"} />
          )}

          <p className="mt-8 text-center text-[0.75rem] text-[var(--text-muted)]">
            Trouble signing in?{" "}
            <Link href="/help" className="font-medium text-[var(--brand-secondary)] hover:underline">
              Get help
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
