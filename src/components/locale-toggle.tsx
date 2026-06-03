"use client";

/**
 * src/components/locale-toggle.tsx
 *
 * EN/ES switch in the nav. Writes the locale cookie client-side and calls
 * router.refresh() so the (force-dynamic) server components re-render in the
 * chosen language. No DB, no reload — the preference is per browser.
 */
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/locale";

export function LocaleToggle({ locale }: { locale: Locale }) {
  const router = useRouter();

  const set = (l: Locale) => {
    if (l === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${l};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
  };

  return (
    <div
      className="inline-flex items-center rounded-md border border-white/20 overflow-hidden text-xs font-semibold"
      role="group"
      aria-label="Language"
    >
      {(["en", "es"] as Locale[]).map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => set(l)}
            aria-pressed={active}
            className={
              "px-2.5 py-1 transition-colors " +
              (active ? "bg-white text-navy-deep" : "text-white/70 hover:text-white hover:bg-white/10")
            }
          >
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
