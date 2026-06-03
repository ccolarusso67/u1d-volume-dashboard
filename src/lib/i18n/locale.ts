/**
 * src/lib/i18n/locale.ts
 *
 * Client-safe locale constants. NO server-only imports here (this module is
 * pulled into the client bundle by the nav language toggle). The server-only
 * getLocale() that reads the request cookie lives in ./server.ts.
 */
export type Locale = "en" | "es";
export const LOCALES: Locale[] = ["en", "es"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "u1d_locale";
