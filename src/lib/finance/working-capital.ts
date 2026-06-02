/**
 * src/lib/finance/working-capital.ts
 *
 * PR 012A — pure helper that derives a working capital snapshot from
 * the AR and AP aging arrays returned by getLatestArAging / getLatestApAging.
 *
 * No DB dependency. Easy to test against fixtures. Used by the board
 * Cash & Working Capital slide / dashboard section.
 */
import type { AgingBuckets, ApAgingRow, ArAgingRow, WorkingCapitalSnapshot } from "./types";

const EMPTY_BUCKETS: AgingBuckets = {
  current_bucket: 0,
  days_1_30: 0,
  days_31_60: 0,
  days_61_90: 0,
  days_91_plus: 0,
};

function sumBuckets(rows: Array<AgingBuckets>): AgingBuckets {
  return rows.reduce<AgingBuckets>(
    (acc, r) => ({
      current_bucket: acc.current_bucket + Number(r.current_bucket),
      days_1_30: acc.days_1_30 + Number(r.days_1_30),
      days_31_60: acc.days_31_60 + Number(r.days_31_60),
      days_61_90: acc.days_61_90 + Number(r.days_61_90),
      days_91_plus: acc.days_91_plus + Number(r.days_91_plus),
    }),
    { ...EMPTY_BUCKETS }
  );
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function computeWorkingCapital(
  ar: ArAgingRow[],
  ap: ApAgingRow[]
): WorkingCapitalSnapshot {
  const total_ar = ar.reduce((s, r) => s + Number(r.total_open_balance), 0);
  const total_ap = ap.reduce((s, r) => s + Number(r.total_open_balance), 0);
  const net_position = total_ar - total_ap;
  const ap_to_ar_ratio = total_ar > 0 ? total_ap / total_ar : null;

  const ar_top = ar[0];
  const ap_top = ap[0];

  let snapshot_at: string | null = null;
  for (const r of ar) snapshot_at = maxIso(snapshot_at, r.snapshot_at);
  for (const r of ap) snapshot_at = maxIso(snapshot_at, r.snapshot_at);

  return {
    total_ar,
    total_ap,
    net_position,
    ap_to_ar_ratio,
    ar_aging: sumBuckets(ar),
    ap_aging: sumBuckets(ap),
    ar_top_concentration: ar_top
      ? {
          name: ar_top.customer_name,
          balance: Number(ar_top.total_open_balance),
          share_pct: total_ar > 0 ? Number(ar_top.total_open_balance) / total_ar : 0,
        }
      : null,
    ap_top_concentration: ap_top
      ? {
          name: ap_top.vendor_name,
          balance: Number(ap_top.total_open_balance),
          share_pct: total_ap > 0 ? Number(ap_top.total_open_balance) / total_ap : 0,
        }
      : null,
    snapshot_at,
  };
}
