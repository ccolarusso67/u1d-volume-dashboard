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
 *   - Italic muted subtitle
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
  return (
    <div
      className={`relative bg-white border border-gray-200 rounded-sm shadow-sm hover:shadow transition-shadow ${className}`}
    >
      {/* Top accent stripe */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] rounded-t-sm ${ACCENT[tone]}`} />
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-medium">
            {label}
          </div>
          {badge && <div>{badge}</div>}
        </div>
        <div className="font-heading text-2xl md:text-3xl font-bold text-navy leading-tight mt-2 tabular-nums">
          {value}
        </div>
        {sub && (
          <div className="text-[11px] text-gray-500 italic mt-1.5 line-clamp-2">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
