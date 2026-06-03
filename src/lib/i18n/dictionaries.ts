/**
 * src/lib/i18n/dictionaries.ts
 *
 * EN/ES string tables for the dashboard UI. English is the source of truth:
 * `Dict = typeof en`, so the Spanish table is compile-time forced to define
 * every key the English one does. Add a key to `en`, and TypeScript will fail
 * the build until `es` has it too. This is what guarantees "nothing left
 * untranslated" for the whole-app pass.
 *
 * Number / date formatting is NOT here — that lives in brand.ts (fmtNum,
 * fmtPct, formatPeriod) and already takes a locale argument.
 */
import type { Locale } from "./locale";

const en = {
  nav: {
    overview: "Overview",
    customers: "Customers",
    products: "Products",
    production: "Production",
    reconciliation: "Reconciliation",
    board: "Board",
    admin: "Admin",
    language: "Language",
  },
};

export type Dict = typeof en;

const es: Dict = {
  nav: {
    overview: "Resumen",
    customers: "Clientes",
    products: "Productos",
    production: "Producción",
    reconciliation: "Reconciliación",
    board: "Directorio",
    admin: "Administración",
    language: "Idioma",
  },
};

const DICTS: Record<Locale, Dict> = { en, es };

export function getDict(locale: Locale): Dict {
  return DICTS[locale];
}
