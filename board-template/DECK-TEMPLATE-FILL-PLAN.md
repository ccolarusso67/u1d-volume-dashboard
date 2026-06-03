# Board deck — template-fill plan (PR-013, WIP)

Goal: the hand-built WorldClass `.pptx` **is** the app's deck template. The app
fills the month's live values into `{{TOKENS}}` embedded in the slides instead
of drawing the deck procedurally.

## Done (scaffolding)
- `board-template/U1Dynamics_Board_Template_TOKENIZED.pptx` — template with tokens in slides 2 and 5 + cover period.
- `src/lib/deck/fill-template-deck.ts` — engine: `fillTemplateDeck(buf, tokens)` (unzip → replace `{{TOKEN}}` in slide XML → rezip) and `buildDeckTokens(view)` (maps `BoardExecutiveDashboard` → token values). Uses jszip (already present via pptxgenjs — no new dependency).
- Verified end-to-end: filled slide 2 renders `$9.47M / $93K / −$202K / 79.4% / 103K` on the exact template layout.

## Wired tokens
`PERIOD_LABEL, VOLUME_SHORT, VOLUME_MOM_LINE, TOP5_SHARE, REVENUE_TTM,
GROSS_MARGIN, NET_INCOME_TTM, NWC_SHORT, NWC_FULL, AR_FULL, AP_FULL, AP_AR_RATIO`

## To finish
1. Tokenize the rest of the template `.pptx` (slides 3, 4, 6, 7, 8, 9): add `{{TOKENS}}` for margin KPIs, top-account shares, operations KPIs, the $19.7M-vs-$9.5M line, etc. Each run is replaced the same way (most are single runs — safe).
2. **Data gap:** slide 3 (customer-book trend 2023→2026) and realized `$/gal` history need 4-year data the `BoardExecutiveDashboard` contract does not carry. Add the queries (a multi-year volume + price aggregate) before those tokens can fill; until then leave those cells static or omit the slide from the auto-fill.
3. Wire into the route behind a flag: in `src/app/api/admin/deck/[year]/[month]/route.ts`, add `?engine=template` to call `fillTemplateDeck(loadTemplate(), buildDeckTokens(view))`; keep `generateMonthlyDeckV2` as default until QA passes.
4. Template source at runtime: read the tokenized `.pptx` from the repo (`board-template/`) or the storage volume; resolve through the existing storage root helper, never hardcode.
5. QA: render filled output for 2–3 historical locked months; confirm no leftover `{{TOKENS}}` and values match the dashboard.

## Notes
- Slides 10–15 of the template are one-time CEO prep, not monthly content — exclude from auto-fill (deck's own slide 10: "use slides 1–9 for the board packet").
- The procedural generator (`generate-monthly-deck-v2.ts`) stays the live path until this is complete and QA'd.
