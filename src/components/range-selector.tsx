/**
 * src/components/range-selector.tsx
 *
 * Trailing-window range selector (Month / 3M / 4M / 6M / YoY). Renders links
 * that set ?range= on the current page; the server page reads it and
 * aggregates over that many trailing months (YoY = 12).
 */
import Link from "next/link";

export const RANGE_OPTIONS = [
  { key: "month", label: "Month", months: 1 },
  { key: "3m", label: "3M", months: 3 },
  { key: "4m", label: "4M", months: 4 },
  { key: "6m", label: "6M", months: 6 },
  { key: "yoy", label: "YoY", months: 12 },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];

export function rangeMonths(key: string): number {
  return RANGE_OPTIONS.find((r) => r.key === key)?.months ?? 1;
}

export function rangeLabel(key: string): string {
  return RANGE_OPTIONS.find((r) => r.key === key)?.label ?? "Month";
}

export function normalizeRange(value: string | string[] | undefined): RangeKey {
  const v = Array.isArray(value) ? value[0] : value;
  return (RANGE_OPTIONS.find((r) => r.key === v)?.key ?? "month") as RangeKey;
}

export function RangeSelector({ current, basePath }: { current: string; basePath: string }) {
  return (
    <div className="inline-flex items-center gap-px rounded-lg border border-line bg-white overflow-hidden">
      {RANGE_OPTIONS.map((r) => {
        const active = current === r.key;
        return (
          <Link
            key={r.key}
            href={`${basePath}?range=${r.key}`}
            aria-current={active ? "true" : undefined}
            className={
              "px-3.5 py-1.5 text-xs font-medium transition-colors " +
              (active ? "bg-navy text-white" : "text-gray-600 hover:bg-gray-50")
            }
          >
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}
