/**
 * src/components/layout/hero-header.tsx
 *
 * PR 005B — Unified executive header used at the top of every page.
 *
 * Slots:
 *   - eyebrow      — small uppercase tracking-wide text above the title
 *                    (defaults to U1Dynamics wordmark when no logo is shown)
 *   - title        — H1 page title
 *   - subtitle     — italic context line (latest period, status, etc.)
 *   - meta         — optional right-aligned line (signed-in user, etc.)
 *   - actions      — optional action area below the title (buttons, links)
 *
 * Design:
 *   - Solid navy band with a thin red accent at the bottom
 *   - Logo on the left (inline SVG by default, override available)
 *   - Type ramp consistent with the deck cover (Georgia for titles)
 */

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Show the inline SVG logo (default true). Pass false on the deepest
   * inner pages if the visual feels too heavy. */
  showLogo?: boolean;
};

export function HeroHeader({
  eyebrow,
  title,
  subtitle,
  meta,
  actions,
  showLogo = true,
}: Props) {
  return (
    <header className="bg-navy text-white relative">
      {/* Subtle vertical gradient for premium feel — pure CSS, no library. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-25 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 50%)",
        }}
      />
      <div className="relative container mx-auto px-8 py-7 max-w-7xl">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-5 flex-1 min-w-0">
            {showLogo && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src="/u1d-logo-white.png"
                alt="U1Dynamics"
                className="flex-shrink-0 hidden sm:block h-12 w-auto"
              />
            )}
            <div className="min-w-0">
              {eyebrow && (
                <div className="text-[10px] tracking-[0.25em] opacity-80 mb-1 uppercase font-medium">
                  {eyebrow}
                </div>
              )}
              <h1 className="font-heading text-3xl md:text-4xl font-bold leading-tight">
                {title}
              </h1>
              {subtitle && (
                <div className="text-sm opacity-85 mt-2 italic max-w-3xl">
                  {subtitle}
                </div>
              )}
            </div>
          </div>
          {meta && (
            <div className="text-xs opacity-80 italic text-right shrink-0 max-w-xs">
              {meta}
            </div>
          )}
        </div>
        {actions && <div className="mt-5">{actions}</div>}
      </div>
      {/* Red accent stripe — single source of "U1D brand" cue */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#E1261C]" />
    </header>
  );
}
