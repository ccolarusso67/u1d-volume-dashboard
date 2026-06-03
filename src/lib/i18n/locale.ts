/**
 * src/lib/i18n/locale.ts
 *
 * Locale resolution for the bilingual (EN/ES) dashboard. The language is a
 * per-browser preference stored in a cookie and toggled from the nav. Server
 * components read it with getLocale(); the toggle writes it client-side and
 * calls router.refresh() so force-dynamic pages re-render in the new language.
 */
import { cookies } from "next/headers";

export type Locale = "en" | "es";
export const LOCALES: Locale[] = ["en", "es"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "u1d_locale";

/** Read the active locale from the request cookie (server components only). */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return store.get(LOCALE_COOKIE)?.value === "es" ? "es" : "en";
}
