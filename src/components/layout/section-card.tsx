/**
 * src/components/layout/section-card.tsx
 *
 * PR 005B — Standard panel used for charts, tables, and content blocks.
 *
 * Variants:
 *   - default — white background, thin gray border, light shadow
 *   - flush   — same shell but no inner padding (caller controls)
 *   - subtle  — light gray background (for informational footers)
 */
type Props = {
  title?: string;
  /** Plain string or inline JSX (links, code, etc.). */
  subtitle?: React.ReactNode;
  eyebrow?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  variant?: "default" | "flush" | "subtle";
  className?: string;
  children: React.ReactNode;
};

export function SectionCard({
  title, subtitle, eyebrow, meta, actions,
  variant = "default", className = "",
  children,
}: Props) {
  const shell =
    variant === "subtle"
      ? "bg-gray-50 border border-gray-200"
      : "bg-white border border-gray-200 shadow-sm";
  const padding = variant === "flush" ? "" : "p-6";

  const hasHeader = !!(title || subtitle || eyebrow || meta || actions);

  return (
    <section className={`${shell} rounded-sm ${padding} ${className}`}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-1">
                {eyebrow}
              </div>
            )}
            {title && (
              <h2 className="font-heading text-xl font-bold text-navy leading-tight">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-xs text-gray-500 mt-1 max-w-2xl">{subtitle}</p>
            )}
          </div>
          {(meta || actions) && (
            <div className="flex items-center gap-3 shrink-0">
              {meta && <div className="text-xs text-gray-500 italic">{meta}</div>}
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
