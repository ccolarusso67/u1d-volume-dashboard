/**
 * src/components/layout/u1d-logo.tsx
 *
 * PR 005B — U1D wordmark used in HeroHeader.
 *
 * Strategy:
 *   - <U1DLogo /> renders the inline SVG wordmark by default (no asset
 *     dependency, looks crisp at any size, navy/red brand-locked).
 *   - When a real raster logo lives at /public/u1d-logo.png, callers can
 *     opt into it by passing `useRaster`. The deck generator (PR 004C)
 *     already picks up that asset for the .pptx cover, so this keeps
 *     the brand consistent across web + deck once the asset lands.
 */

type Props = {
  /** Pixel height of the rendered mark. Width is auto. */
  size?: number;
  /** Override default light/dark palette. */
  tone?: "light" | "dark";
  /** If true, render <img src="/u1d-logo.png" /> instead of the inline SVG. */
  useRaster?: boolean;
  /** Optional aria-label override. */
  label?: string;
};

export function U1DLogo({
  size = 32,
  tone = "light",
  useRaster = false,
  label = "U1Dynamics Manufacturing LLC",
}: Props) {
  if (useRaster) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/u1d-logo.png"
        alt={label}
        height={size}
        style={{ height: size, width: "auto" }}
      />
    );
  }

  // Inline SVG mark: "U1" inside a navy square + "D" cap mark + red accent
  // bar. Designed to read at sizes 20px → 60px.
  const navy = tone === "light" ? "#FFFFFF" : "#003C71";
  const red  = "#E1261C";
  const stroke = tone === "light" ? "#FFFFFF" : "#003C71";

  return (
    <svg
      width={size * 2.7}
      height={size}
      viewBox="0 0 270 100"
      role="img"
      aria-label={label}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Square mark on the left */}
      <rect x="2" y="2" width="96" height="96" rx="8"
        fill="none" stroke={stroke} strokeWidth="4" />
      <text x="50" y="68" textAnchor="middle" fontFamily="Georgia, serif"
        fontWeight="bold" fontSize="52" fill={navy}>U1</text>
      {/* Wordmark on the right */}
      <text x="118" y="58" fontFamily="Georgia, serif" fontWeight="bold"
        fontSize="42" fill={navy}>DYNAMICS</text>
      {/* Red accent under wordmark */}
      <rect x="118" y="70" width="148" height="4" fill={red} />
      {/* Tagline */}
      <text x="118" y="92" fontFamily="Calibri, Arial, sans-serif"
        fontSize="11" fill={navy} letterSpacing="2">
        MANUFACTURING LLC
      </text>
    </svg>
  );
}
