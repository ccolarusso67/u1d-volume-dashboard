# U1Dynamics Board Deck — Template Specification

This is the **canonical template** for the monthly U1Dynamics board operating review.
Every month's deck is built from `U1Dynamics_Board_Template.pptx` and must hold to the
design system and slide architecture below. This is the standard referenced in the
Phase 2 `.pptx` deck-generator roadmap.

The governing rule (from the deck's own appendix):

> **Every slide must answer: what does the board need to believe, decide, or challenge because of this information?**
> No slide ships without a board action.

---

## 1. Design system (design tokens)

| Token | Value | Use |
|---|---|---|
| Display / heading font | **Aptos Display** | Slide titles, hero numbers |
| Body font | **Aptos** | Body, labels, tables |
| Cover navy | `#071326` | Cover background, dark panels |
| Callout navy | `#0B1F3A` | "Board implication" boxes |
| Brand red | `#B42318` | Accent rules, kicker text, risk numbers, recommendation strip |
| Ink (body text) | `#111827` | Primary text |
| Slate | `#475467` | Sub-labels, secondary text |
| Light slate | `#98A2B3` | Kickers, footer, captions |
| Paper | `#FDFDFB` | Content slide background |
| Card fill | `#F2F4F7` | KPI / metric cards |
| Hairline | `#E4E7EC` | Card borders, table rules |
| Positive | `#027A48` | Authoritative-data checks |

Layout: 13.33 × 7.5 in (16:9 widescreen).

### Recurring components
- **Kicker** — uppercase, tracked, light-slate, top-left (`BOARD OPERATING REVIEW · {MONTH YEAR}`).
- **Title** — Aptos Display, navy, sentence case, states a conclusion (never a topic).
- **KPI card** — light `#F2F4F7` fill, hairline border; tiny slate label, large navy value, small caption. Risk values render in red `#B42318`.
- **Board-implication box** — dark `#0B1F3A` panel, white text. One per analytical slide.
- **Recommendation strip** — full-width, red kicker `RECOMMENDATION`, one decisive sentence.
- **Footer** — `U1Dynamics Manufacturing LLC · {Month Year} · Confidential` + page number.

---

## 2. Slide architecture (board-facing: slides 1–9)

| # | Headline (rewrite the conclusion, keep the role) | Visual | Board action |
|---|---|---|---|
| 1 | Cover — Board Operating Review · {Month Year} | Premium navy cover | Set control / tone |
| 2 | The decision: convert volume into margin, cash, resilience | 5 hero KPIs + 3 asks + implication | Approve 3 decisions |
| 3 | The enterprise signal: bigger in volume, narrower in exposure | Customer-book trend table + delta column | Set concentration target |
| 4 | Margin is recovering, but still below the value-creation line | 4 KPIs + margin bridge bar | Approve price/mix program |
| 5 | Vendor credit is carrying part of the operating cycle | NWC hero + 30/60/90 plan | Approve 30/60/90 |
| 6 | Intercompany-weighted account is a classification issue | Top-account share bars | Resolve treatment |
| 7 | The plant is not the bottleneck; inventory visibility is the open item | Operating-signal cards | Add inventory anchor |
| 8 | We will not ask the board to decide on non-board-grade numbers | Authoritative vs pending map | Protect credibility |
| 9 | Three approvals de-risk the enterprise in the next 90 days | Decision table (owner + outcome) | Board approval |

## 3. Presenter / CEO-prep section (slides 10–15) — **do not circulate to the board**
10 — Rebuild logic / the new standard. 11 — Slide map. 12 — Scripts (90s / 3min / 15min).
13 — Likely board questions + answers. 14 — One-page board memo. 15 — Send checklist & guardrails.

Use **slides 1–9** for the board packet. Keep **10–15** as presenter prep.

---

## 4. Monthly workflow

1. Duplicate `U1Dynamics_Board_Template.pptx` → `U1Dynamics_Board_Report_{YYYY}_{MM}.pptx`.
2. Update the cover month and every kicker/footer to the new period.
3. Replace the KPI values **only from locked Postgres data** (never re-parse the Excel — see project CLAUDE.md, storage rule 8).
4. Rewrite each headline so it states *this month's* conclusion, not a generic topic.
5. Keep every data caveat explicit. **Do not** circulate per-customer dollars until the
   customer-file revenue reconciles to the QuickBooks P&L.
6. Refresh the finance sync before distribution.
7. Board packet = slides 1–9. Presenter keeps 10–15.

---

## 5. Hard guardrails (carry every month)
- QuickBooks P&L is the authoritative revenue/margin source. The customer-file revenue
  view is **not** board-grade until it reconciles to the GL.
- Net working capital, AR/AP, and the concentration trend are board-grade.
- Name the data gaps *before* the board finds them (slide 8).
- No slide without a board action.

_Last set as template: see git history. Source deck: WorldClass_Rebuild (April 2026)._
