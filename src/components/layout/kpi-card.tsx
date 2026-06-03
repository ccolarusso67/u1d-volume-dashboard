/**
 * src/components/layout/kpi-card.tsx
 *
 * PR 005B — Unified KPI tile used on the public dashboard, the board
 * dashboard's executive snapshot, and other metric rows.
 *
 * Design:
 *   - White surface, subtle border, light shadow
 *   - Top accent stripe (navy / emerald / amber / red) for trend cues
 *   - Small uppercase muted label
 *   - Strong Georgia value
 *   - Muted subtitle pinned to the card baseline
 */
type Tone = "navy" | "ok" | "warn" | "red" | "neutral";

type Props = {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: Tone;
  /** Optional small icon or badge slot to the right of the label. */
  badge?: React.ReactNode;
  className?: string;
};

const ACCENT: Record<Tone, string> = {
  navy:    "bg-navy",
  ok:      "bg-emerald-600",
  warn:    "bg-amber-500",
  red:     "bg-red-600",
  neutral: "bg-gray-300",
};

export function KpiCard({
  label, value, sub, tone = "navy", badge, className = "",
}: Props) {
  // Any negative value renders in red (leading hyphen, unicode minus, or paren).
  const isNegative = /^\s*[-−(]/.test(value);
  return (
    <div
      className={`relative h-full min-h-[142px] bg-white border border-line rounded-lg shadow-sm ${className}`}
    >
      {/* Top accent stripe */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] rounded-t-sm ${ACCENT[tone]}`} />
      <div className="flex h-full flex-col px-5 pt-5 pb-4">
        <div className="flex min-h-[2rem] items-start justify-between gap-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 font-semibold leading-snug">
            {label}
          </div>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>
        <div className={`font-heading text-[1.75rem] md:text-[2rem] font-bold leading-none mt-3 tabular-nums ${isNegative ? "text-red-600" : "text-navy"}`}>
          {value}
        </div>
        {sub && (
          <div className="text-[11px] text-gray-500 mt-auto pt-3 leading-snug line-clamp-2">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
