/**
 * src/lib/board/narrative.ts
 *
 * Deterministic board commentary generated only from the executive dashboard
 * payload. This module deliberately avoids external calls and free-form data.
 */
import type { BoardExecutiveDashboard, ExecDeltaSet } from "./executive-types";

export type NarrativeSeverity = "positive" | "neutral" | "watch" | "risk";

export type BoardNarrativeBullet = {
  text: string;
  severity: NarrativeSeverity;
};

export type BoardNarrativeSection = {
  id: "executive-readout" | "key-observations" | "management-focus" | "data-limitations";
  title: string;
  paragraphs?: string[];
  bullets?: BoardNarrativeBullet[];
};

export type BoardNarrative = {
  sections: BoardNarrativeSection[];
};

const TOP_CUSTOMER_WATCH = 0.25;
const TOP_CUSTOMER_RISK = 0.4;
const TOP5_WATCH = 0.65;
const TOP5_RISK = 0.8;
const INTERCOMPANY_WATCH = 0.5;
const PACKAGE_WATCH = 0.25;
const CATEGORY_WATCH = 0.5;

export function generateBoardNarrative(view: BoardExecutiveDashboard): BoardNarrative {
  const keyObservations: BoardNarrativeBullet[] = [];
  const managementFocus: BoardNarrativeBullet[] = [];
  const limitations: BoardNarrativeBullet[] = [];

  const totalGallons = view.currentMetrics.total_gallons;
  const customerCount = view.currentMetrics.customer_count;
  const packageCount = view.currentMetrics.package_count;

  const readout: string[] = [
    `${view.period.label} closed at ${formatGallons(totalGallons)} across ${formatCount(customerCount, "active customer")} and ${formatCount(packageCount, "package type")}.`,
  ];

  const mom = comparisonSentence("Volume", view.priorMonth, "the prior month");
  if (mom) {
    readout.push(mom.text);
    keyObservations.push({
      text: mom.observation,
      severity: mom.severity,
    });
  } else {
    limitations.push({
      text: "Prior-month comparison is not available because no locked prior-month data was found.",
      severity: "neutral",
    });
  }

  const yoy = comparisonSentence("Volume", view.priorYear, `the same month in ${view.period.year - 1}`);
  if (yoy) {
    keyObservations.push({
      text: yoy.observation,
      severity: yoy.severity,
    });
  } else {
    limitations.push({
      text: "Prior-year comparison is not available because no locked same-month prior-year data was found.",
      severity: "neutral",
    });
  }

  if (view.ytd.months_included > 0) {
    const ytdSentence = ytdReadout(view);
    readout.push(ytdSentence);
    keyObservations.push({
      text: ytdObservation(view),
      severity: view.ytd.delta_gallons === null ? "neutral" : severityForDelta(view.ytd.delta_gallons),
    });
  }

  if (view.ytd.prior_year_gallons === null) {
    limitations.push({
      text: "Prior-year YTD comparison is not available because comparable locked YTD data was not found.",
      severity: "neutral",
    });
  }

  addCloseNarrative(view, keyObservations, managementFocus);
  addConcentrationNarrative(view, keyObservations, managementFocus);
  addMixNarrative(view, keyObservations, managementFocus, limitations);

  if (managementFocus.length < 2) {
    managementFocus.push({
      text: "Continue monitoring customer and package concentration as the next close is prepared.",
      severity: "neutral",
    });
  }
  if (managementFocus.length < 2) {
    managementFocus.push({
      text: "Use current-period movers to confirm whether visible mix shifts require management action.",
      severity: "neutral",
    });
  }

  const sections: BoardNarrativeSection[] = [
    {
      id: "executive-readout",
      title: "Executive readout",
      paragraphs: [readout.slice(0, 4).join(" ")],
    },
    {
      id: "key-observations",
      title: "Key observations",
      bullets: selectKeyObservations(keyObservations),
    },
    {
      id: "management-focus",
      title: "Management focus",
      bullets: managementFocus.slice(0, 5),
    },
  ];

  if (limitations.length > 0) {
    sections.push({
      id: "data-limitations",
      title: "Data limitations",
      bullets: dedupeBullets(limitations),
    });
  }

  return { sections };
}

function addConcentrationNarrative(
  view: BoardExecutiveDashboard,
  observations: BoardNarrativeBullet[],
  focus: BoardNarrativeBullet[]
) {
  const concentration = view.customerConcentration;

  if (concentration.top_customer_share !== null) {
    const severity = concentration.top_customer_share >= TOP_CUSTOMER_RISK
      ? "risk"
      : concentration.top_customer_share >= TOP_CUSTOMER_WATCH ? "watch" : "neutral";
    observations.push({
      text: `${concentration.top_customer_name ?? "The top customer"} represents ${formatShare(concentration.top_customer_share)} of monthly gallons.`,
      severity,
    });
    if (severity !== "neutral") {
      focus.push({
        text: `Review customer dependency for ${concentration.top_customer_name ?? "the top customer"} before the next board cycle.`,
        severity,
      });
    }
  }

  if (concentration.top5_share !== null && concentration.top5_share >= TOP5_WATCH) {
    const severity = concentration.top5_share >= TOP5_RISK ? "risk" : "watch";
    observations.push({
      text: `The top five customers account for ${formatShare(concentration.top5_share)} of monthly gallons.`,
      severity,
    });
    focus.push({
      text: "Assess whether top-customer concentration changes commercial or operational exposure.",
      severity,
    });
  }

  if (concentration.intercompany_share !== null) {
    if (concentration.intercompany_share >= INTERCOMPANY_WATCH) {
      observations.push({
        text: `Intercompany volume represents ${formatShare(concentration.intercompany_share)} of monthly gallons; external demand should be reviewed separately.`,
        severity: "watch",
      });
      focus.push({
        text: "Separate intercompany volume from external demand when reviewing market-facing performance.",
        severity: "watch",
      });
    } else if (concentration.external_share !== null) {
      observations.push({
        text: `External accounts represent ${formatShare(concentration.external_share)} of monthly gallons.`,
        severity: "neutral",
      });
    }
  }
}

function addMixNarrative(
  view: BoardExecutiveDashboard,
  observations: BoardNarrativeBullet[],
  focus: BoardNarrativeBullet[],
  limitations: BoardNarrativeBullet[]
) {
  const topSlice = view.categoryMix.slices[0] ?? null;
  if (topSlice) {
    const severity = topSlice.share >= CATEGORY_WATCH ? "watch" : "neutral";
    observations.push({
      text: `Product mix is led by ${topSlice.category} at ${formatShare(topSlice.share)} of monthly gallons.`,
      severity,
    });
    if (severity === "watch") {
      focus.push({
        text: `Review whether the ${topSlice.category} mix concentration affects near-term production and supply planning.`,
        severity,
      });
    }
  } else {
    limitations.push({
      text: "Product/package mix is not available because no package volume rows were present.",
      severity: "neutral",
    });
  }

  const topPackage = view.topPackages[0] ?? null;
  if (topPackage?.share_pct !== null && topPackage?.share_pct !== undefined) {
    const severity = topPackage.share_pct >= PACKAGE_WATCH ? "watch" : "neutral";
    observations.push({
      text: `${topPackage.package_label} is the largest package at ${formatShare(topPackage.share_pct)} of monthly gallons.`,
      severity,
    });
    if (severity === "watch") {
      focus.push({
        text: `Confirm whether ${topPackage.package_label} concentration changes inventory, capacity, or service-risk assumptions.`,
        severity,
      });
    }
  }
}

function addCloseNarrative(
  view: BoardExecutiveDashboard,
  observations: BoardNarrativeBullet[],
  focus: BoardNarrativeBullet[]
) {
  const pending = view.alertSummary.pending_alerts_total;
  const resolved = view.alertSummary.resolved_alerts_total;

  if (pending > 0) {
    observations.push({
      text: `${formatCount(pending, "operational alert")} ${pending === 1 ? "remains" : "remain"} pending after close.`,
      severity: "risk",
    });
    focus.push({
      text: `Resolve or disposition ${formatCount(pending, "pending alert")} before distribution follow-up.`,
      severity: "risk",
    });
  } else if (resolved > 0) {
    observations.push({
      text: `${formatCount(resolved, "alert")} ${resolved === 1 ? "was" : "were"} resolved during close, with no pending alerts remaining.`,
      severity: "positive",
    });
  } else {
    observations.push({
      text: "No operational alerts were recorded for this close.",
      severity: "neutral",
    });
  }

  if (view.reopenCount > 0) {
    observations.push({
      text: `The period required ${formatCount(view.reopenCount, "reopen")} before final lock.`,
      severity: "watch",
    });
    focus.push({
      text: "Review reopen drivers and confirm the final locked file is the version used for board distribution.",
      severity: "watch",
    });
  } else {
    observations.push({
      text: "The period remained stable after first lock; no reopens were recorded.",
      severity: "positive",
    });
  }
}

function comparisonSentence(
  subject: string,
  comparison: (ExecDeltaSet & { total_gallons: number }) | null,
  label: string
): { text: string; observation: string; severity: NarrativeSeverity } | null {
  if (!comparison) return null;

  const deltaGallons = comparison.delta_gallons;
  if (deltaGallons === null) return null;
  const deltaPct = comparison.delta_pct;
  const severity = severityForDelta(deltaGallons ?? 0);
  const direction = deltaGallons === 0 ? "was flat" : deltaGallons > 0 ? "increased" : "decreased";
  const deltaText = formatSignedGallons(deltaGallons);

  if (deltaPct === null) {
    return {
      text: `${subject} ${direction} by ${deltaText} versus ${label}; percentage comparison is not meaningful because the prior base was zero.`,
      observation: `${subject} ${direction} by ${deltaText} versus ${label}; percentage comparison is not meaningful because the prior base was zero.`,
      severity,
    };
  }

  const sentence = `${subject} ${direction} ${formatAbsPercent(deltaPct)} (${deltaText}) versus ${label}.`;
  return {
    text: sentence,
    observation: sentence,
    severity,
  };
}

function ytdReadout(view: BoardExecutiveDashboard): string {
  const base = `Year-to-date volume is ${formatGallons(view.ytd.current_year_gallons)} across ${formatCount(view.ytd.months_included, "locked month")}`;
  if (view.ytd.prior_year_gallons === null) return `${base}.`;
  if (view.ytd.delta_gallons === null || view.ytd.delta_pct === null) {
    return `${base}; percentage comparison to prior YTD is not meaningful because the prior base was zero.`;
  }
  const direction = view.ytd.delta_gallons === 0 ? "flat" : view.ytd.delta_gallons > 0 ? "up" : "down";
  return `${base}, ${direction} ${formatAbsPercent(view.ytd.delta_pct)} (${formatSignedGallons(view.ytd.delta_gallons)}) versus prior YTD.`;
}

function ytdObservation(view: BoardExecutiveDashboard): string {
  const months = `${view.ytd.months_included} of ${view.ytd.months_included + view.ytd.months_missing} months`;
  if (view.ytd.prior_year_gallons === null) {
    return `YTD includes ${months} locked for the current year; prior-year YTD comparison is not available.`;
  }
  if (view.ytd.delta_gallons === null || view.ytd.delta_pct === null) {
    return `YTD includes ${months} locked; prior-year percentage comparison is not meaningful because the prior base was zero.`;
  }
  const direction = view.ytd.delta_gallons === 0 ? "flat" : view.ytd.delta_gallons > 0 ? "up" : "down";
  return `YTD volume is ${direction} ${formatAbsPercent(view.ytd.delta_pct)} (${formatSignedGallons(view.ytd.delta_gallons)}) versus prior YTD.`;
}

function severityForDelta(delta: number): NarrativeSeverity {
  if (delta > 0) return "positive";
  if (delta < 0) return "risk";
  return "neutral";
}

function formatGallons(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} gallons`;
}

function formatCount(value: number, singular: string): string {
  const rounded = Math.round(value);
  return `${rounded.toLocaleString("en-US")} ${rounded === 1 ? singular : `${singular}s`}`;
}

function formatShare(value: number): string {
  return formatAbsPercent(value);
}

function formatAbsPercent(value: number): string {
  return `${Math.abs(value * 100).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatSignedGallons(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("en-US")} gallons`;
}

function dedupeBullets(bullets: BoardNarrativeBullet[]): BoardNarrativeBullet[] {
  const seen = new Set<string>();
  return bullets.filter((bullet) => {
    if (seen.has(bullet.text)) return false;
    seen.add(bullet.text);
    return true;
  });
}

function selectKeyObservations(bullets: BoardNarrativeBullet[]): BoardNarrativeBullet[] {
  const unique = dedupeBullets(bullets);
  const urgent = unique.filter((bullet) => bullet.severity === "risk" || bullet.severity === "watch");
  const remaining = unique.filter((bullet) => bullet.severity !== "risk" && bullet.severity !== "watch");
  return [...urgent, ...remaining].slice(0, 6);
}
