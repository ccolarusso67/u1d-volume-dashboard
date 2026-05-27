/**
 * src/app/login/page.tsx
 *
 * PR 003A — Sign-in page.
 *
 * Renders a single "Sign in with Google" button that triggers the Auth.js
 * server action. Two failure modes are surfaced inline:
 *   - ?error=AccessDenied — Google sign-in succeeded but the email is not
 *     in the u1d_ops.users allowlist (or is inactive).
 *   - ?error=Configuration — env var missing or NextAuth misconfigured.
 *
 * No client JS required: the form posts to the Auth.js sign-in endpoint
 * which handles the OAuth redirect.
 */
import { signIn } from "@/auth";

type SearchParams = { [key: string]: string | string[] | undefined };

function errorMessage(errorParam?: string | string[]): string | null {
  if (!errorParam) return null;
  const code = Array.isArray(errorParam) ? errorParam[0] : errorParam;
  switch (code) {
    case "AccessDenied":
      return "Your Google account is not authorized to access this dashboard. Contact an administrator to be added to the allowlist.";
    case "Configuration":
      return "Authentication is not configured correctly. Contact an administrator.";
    case "Verification":
      return "The sign-in link is no longer valid.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

export default async function LoginPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const callbackUrl = typeof searchParams.callbackUrl === "string"
    ? searchParams.callbackUrl
    : "/admin";
  const message = errorMessage(searchParams.error);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-sm shadow-sm px-8 py-10">
        <div className="text-[11px] tracking-[0.2em] text-gray-500 mb-2">
          U1DYNAMICS MANUFACTURING LLC
        </div>
        <h1 className="font-heading text-2xl font-bold text-navy mb-6">
          Admin Sign-in
        </h1>

        {message && (
          <div
            role="alert"
            className="mb-6 text-sm bg-red-50 border border-red-200 text-red-900 px-4 py-3 rounded-sm"
          >
            {message}
          </div>
        )}

        <p className="text-sm text-gray-600 mb-6">
          Sign in with your Ultra1Plus Google account to access the admin
          surface. The public dashboards at{" "}
          <a href="/" className="text-navy underline">Overview</a>,{" "}
          <a href="/production" className="text-navy underline">Production</a>,
          and{" "}
          <a href="/reconciliation" className="text-navy underline">Reconciliation</a>{" "}
          do not require sign-in.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl });
          }}
        >
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-3 bg-navy hover:bg-navy-deep text-white font-medium text-sm px-4 py-3 rounded-sm transition-colors"
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
              <path d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.35-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.44 1.18 4.93l3.66-2.84z"/>
              <path d="M12 5.38c1.62 0 3.06.55 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/>
            </svg>
            Sign in with Google
          </button>
        </form>

        <p className="text-xs text-gray-500 italic mt-6">
          Access is limited to the email allowlist in <code>u1d_ops.users</code>.
        </p>
      </div>
    </main>
  );
}
