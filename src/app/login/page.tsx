/**
 * src/app/login/page.tsx
 *
 * Sign-in page. Primary method is email + password (Credentials provider,
 * backed by the u1d_ops.users allowlist). Google sign-in is kept as a
 * fallback for accounts that have it configured.
 *
 * Error modes surfaced inline via ?error=:
 *   - CredentialsSignin — wrong email/password, or no password set.
 *   - AccessDenied      — authenticated but not in the allowlist / inactive.
 *   - Configuration     — provider/env misconfigured.
 */
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function LoginPage(props: { searchParams: Promise<SearchParams> }) {
  const locale = await getLocale();
  const d = getDict(locale);
  const t = d.login;

  function errorMessage(errorParam?: string | string[]): string | null {
    if (!errorParam) return null;
    const code = Array.isArray(errorParam) ? errorParam[0] : errorParam;
    switch (code) {
      case "CredentialsSignin": return t.errCredentials;
      case "AccessDenied": return t.errAccessDenied;
      case "Configuration": return t.errConfig;
      case "Verification": return t.errVerification;
      default: return t.errDefault;
    }
  }

  const searchParams = await props.searchParams;
  const callbackUrl =
    typeof searchParams.callbackUrl === "string" ? searchParams.callbackUrl : "/admin";
  const message = errorMessage(searchParams.error);

  async function passwordSignIn(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    try {
      await signIn("credentials", { email, password, redirectTo: callbackUrl });
    } catch (error) {
      if (error instanceof AuthError) {
        redirect(
          `/login?error=CredentialsSignin&callbackUrl=${encodeURIComponent(callbackUrl)}`
        );
      }
      throw error; // success path throws NEXT_REDIRECT — must be rethrown
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-sm shadow-sm px-8 py-10">
        <div className="text-[11px] tracking-[0.2em] text-gray-500 mb-2">
          {d.common.company}
        </div>
        <h1 className="font-heading text-2xl font-bold text-navy mb-6">{t.title}</h1>

        {message && (
          <div
            role="alert"
            className="mb-6 text-sm bg-red-50 border border-red-200 text-red-900 px-4 py-3 rounded-sm"
          >
            {message}
          </div>
        )}

        <p className="text-sm text-gray-600 mb-6">
          {t.intro1} <code>u1d_ops.users</code>. {t.publicAt}{" "}
          <a href="/" className="text-navy underline">{d.nav.overview}</a>,{" "}
          <a href="/production" className="text-navy underline">{d.nav.production}</a>, {t.and}{" "}
          <a href="/reconciliation" className="text-navy underline">{d.nav.reconciliation}</a>{" "}
          {t.noSignin}
        </p>

        <form action={passwordSignIn} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-700 mb-1">
              {t.email}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/40"
              placeholder="you@ultra1plus.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-gray-700 mb-1">
              {t.password}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/40"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center bg-navy hover:bg-navy-deep text-white font-medium text-sm px-4 py-3 rounded-sm transition-colors"
          >
            {t.submit}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />
          {t.or}
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl });
          }}
        >
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-3 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium text-sm px-4 py-3 rounded-sm transition-colors"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
              <path d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.35-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.44 1.18 4.93l3.66-2.84z" />
              <path d="M12 5.38c1.62 0 3.06.55 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
            </svg>
            {t.google}
          </button>
        </form>

        <p className="text-xs text-gray-500 italic mt-6">
          {t.footer}
        </p>
      </div>
    </main>
  );
}
