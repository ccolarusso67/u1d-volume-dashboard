/**
 * tests/fixtures/board-period.ts
 *
 * PR 004B — A small but realistic BoardPeriodView fixture used by the
 * deck generator tests. Mirrors the shape returned by getBoardPeriod()
 * with all fields populated for a board-ready period.
 *
 * Override anything with the partial-merge helper.
 */
import type { BoardPeriodView } from "../../src/lib/board/types";

export function makeBoardFixture(overrides?: {
  ready?: boolean;
  reopened?: boolean;
  noPriorMonth?: boolean;
  longNotes?: boolean;
  empty?: boolean;
  partial?: Partial<BoardPeriodView>;
}): BoardPeriodView {
  const ready = overrides?.ready ?? true;
  const reopened = overrides?.reopened ?? false;
  const noPrior = overrides?.noPriorMonth ?? false;
  const empty = overrides?.empty ?? false;
  const longNotes = overrides?.longNotes ?? false;

  const notes = longNotes
    ? {
        capacity_production: "Capacity ".repeat(200),
        supply_chain: "Supply chain ".repeat(200),
        quality_incidents: "Quality ".repeat(200),
        initiatives: "Initiatives ".repeat(300),
        risks: "Risks ".repeat(300),
        completed_at: "2026-05-30T14:00:00Z",
        completed_by: "eugenio@x",
      }
    : {
        capacity_production:
          "Plant ran at 78% utilization. No unplanned downtime. Drum line cleared backlog.",
        supply_chain:
          "Base oil deliveries on schedule. One additive lead-time slip noted, mitigated.",
        quality_incidents:
          "Zero recordable incidents. One minor labeling deviation resolved on May 14.",
        initiatives:
          "Launched Q3 SKU rationalization pilot. DEF expansion sales pipeline updated.",
        risks:
          "Single-source exposure on additive package #2. Mitigation plan due June 15.",
        completed_at: "2026-05-30T14:00:00Z",
        completed_by: "eugenio@x",
      };

  const base: BoardPeriodView = {
    period: {
      year: 2026,
      month: 5,
      label: "May 2026",
      status: ready ? "locked" : "in_review",
      locked_at: ready ? "2026-05-30T15:00:00Z" : null,
      locked_by: ready ? "carmine@x" : null,
    },
    readiness: {
      ready,
      blockers: ready ? [] : ["operator_notes_incomplete"],
    },
    activeFile: {
      file_id: 1001,
      filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
      version_no: 3,
      uploaded_at: "2026-05-26T15:30:00Z",
      uploaded_by: "carmine@x",
      file_hash_prefix: "a1b2c3d4",
      total_gallons: 175319,
      source_total_gallons: 175319,
      reconstructed_total_gallons: 175319,
      has_total_discrepancy: false,
    },
    headlineMetrics: {
      total_gallons: empty ? 0 : 175319,
      prior_month_total_gallons: noPrior ? null : 150000,
      month_over_month_delta_gallons: noPrior ? null : 25319,
      month_over_month_delta_pct: noPrior ? null : 25319 / 150000,
      customer_count: empty ? 0 : 5,
      package_count: empty ? 0 : 12,
      fact_row_count: empty ? 0 : 50,
    },
    topCustomers: empty ? [] : [
      {
        customer_key: "ULTRACHEM",
        customer_name: "ULTRACHEM",
        gallons: 120000,
        share_pct: 120000 / 175319,
        prior_month_gallons: noPrior ? null : 100000,
        delta_gallons: noPrior ? null : 20000,
        delta_pct: noPrior ? null : 0.2,
      },
      {
        customer_key: "KEY PERFORMANCE",
        customer_name: "Key Performance",
        gallons: 55319,
        share_pct: 55319 / 175319,
        prior_month_gallons: noPrior ? null : 50000,
        delta_gallons: noPrior ? null : 5319,
        delta_pct: noPrior ? null : 5319 / 50000,
      },
    ],
    topPackages: empty ? [] : [
      {
        package_key: "DRUM OIL",
        package_label: "Drum Oil",
        gallons: 80000,
        share_pct: 80000 / 175319,
        prior_month_gallons: noPrior ? null : 70000,
        delta_gallons: noPrior ? null : 10000,
        delta_pct: noPrior ? null : 10000 / 70000,
      },
      {
        package_key: "BOX OIL",
        package_label: "Box Oil",
        gallons: 50000,
        share_pct: 50000 / 175319,
        prior_month_gallons: noPrior ? null : 50000,
        delta_gallons: noPrior ? null : 0,
        delta_pct: noPrior ? null : 0,
      },
    ],
    operatorNotes: notes,
    alertSummary: {
      package_alerts_total: 2,
      customer_alerts_total: 1,
      data_quality_alerts_total: 0,
      resolved_alerts_total: 3,
      pending_alerts_total: 0,
    },
    lockHistory: reopened
      ? [
          {
            event_id: 3, event_type: "locked",
            event_at: "2026-05-30T15:00:00Z", event_by: "carmine@x",
            prior_status: "reopened", new_status: "locked",
            file_id: 1001, version_no: 3, filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
          },
          {
            event_id: 2, event_type: "reopened",
            event_at: "2026-05-29T15:00:00Z", event_by: "eugenio@x",
            prior_status: "locked", new_status: "reopened",
            file_id: 1001, version_no: 3, filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
          },
          {
            event_id: 1, event_type: "locked",
            event_at: "2026-05-28T15:00:00Z", event_by: "carmine@x",
            prior_status: "in_review", new_status: "locked",
            file_id: 1001, version_no: 2, filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
          },
        ]
      : [
          {
            event_id: 1, event_type: "locked",
            event_at: "2026-05-30T15:00:00Z", event_by: "carmine@x",
            prior_status: "in_review", new_status: "locked",
            file_id: 1001, version_no: 3, filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
          },
        ],
  };

  return { ...base, ...(overrides?.partial ?? {}) };
}
