type KPITileProps = {
  label: string;
  value: string;
  subtitle?: string;
  accent?: "navy" | "red" | "success" | "neutral";
};

const ACCENT_CLASSES: Record<NonNullable<KPITileProps["accent"]>, string> = {
  navy: "border-t-navy",
  red: "border-t-[#E1261C]",
  success: "border-t-emerald-600",
  neutral: "border-t-gray-300",
};

export function KPITile({
  label,
  value,
  subtitle,
  accent = "navy",
}: KPITileProps) {
  const isNegative = /^\s*[-−(]/.test(value);
  return (
    <div
      className={`bg-white border border-gray-200 border-t-4 ${ACCENT_CLASSES[accent]} rounded-sm shadow-sm px-5 py-4`}
    >
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">
        {label}
      </div>
      <div className={`font-heading text-3xl font-bold leading-tight ${isNegative ? "text-red-600" : "text-navy"}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-gray-500 italic mt-2">{subtitle}</div>
      )}
    </div>
  );
}
