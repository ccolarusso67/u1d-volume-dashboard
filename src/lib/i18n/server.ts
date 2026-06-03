/**
 * src/lib/i18n/server.ts
 *
 * Server-only locale resolution. Reads the language cookie from the request.
 * Kept separate from locale.ts so the client toggle never pulls next/headers
 * into the client bundle.
 */
import { cookies } from "next/headers";
import { type Locale, LOCALE_COOKIE } from "./locale";

/** Read the active locale from the request cookie (server components only). */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return store.get(LOCALE_COOKIE)?.value === "es" ? "es" : "en";
}
