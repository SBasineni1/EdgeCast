# Nexus-Style Light UI Conversion

**Goal:** Convert the EdgeCast dashboard from the dark ZenWallet theme (commit e9d4692) to a light, bright, Nexus-style look per the user's reference video: near-white page, white rounded cards with subtle borders and soft shadows, generous whitespace, color reserved for data.

**Decisions (user):** green accent identity on light (sea green #058C42 primary, malachite #16DB65 secondary) — not the video's violet; rounded corners like the video; keep the three-column layout (sidebar / main / city rail).

**Strategy:** the components consume theme tokens, so step 1 redefines the existing token *names* with light values (minimal diffs), then per-component polish adds borders/shadows/chips and the video's KPI-card hero row.

## Global Constraints

- Do NOT run `git commit` or `git push`. Ever. The user commits manually.
- Keep all data-testids, aria attributes, and component APIs; App tests assert heading "Chicago", `hero-temp` textContent "88.5°", MIDWAY text, `ladder-row` counts.
- GSAP animations (entrance stagger, count-up, chart draw-in, pulse) are kept as-is; reduced-motion gating unchanged.
- No new dependencies (Space Grotesk stays).

## Token remap (`web/src/theme.css`) — same names, light values

```css
--color-ink: #f6f7f5;                 /* page background (was near-black) */
--color-panel: #ffffff;               /* cards */
--color-panel-2: #eef1ec;             /* hover / inset fills */
--color-lime: #058c42;                /* primary accent (active nav, model line, buttons) */
--color-lime-ink: #ffffff;            /* text on accent fills */
--color-gold: #334155;                /* market line — neutral dark slate on light */
--color-text-1: #17241c;
--color-text-2: #5c6b61;
--color-text-3: #8a978d;
--color-hairline: #e7eae5;            /* card borders / row separators */
--color-up: #058c42;
--color-down: #d94f4f;
```

Body: flat `var(--color-ink)` background, `color: var(--color-text-1)` (gradients removed). Note `text-lime`-on-dark usages read fine as green-on-light; `bg-white/10` insets must become `bg-panel-2`.

## Tasks (SDD, opus implementers, sequential)

### Task 1 — Tokens + App + TopBar foundation
theme.css remap above. App.tsx: error strips become white cards `rounded-xl border border-hairline bg-panel` with a red leading label; SIGNAL LOST inverts to light. TopBar: LIVE chip `border border-hairline bg-panel text-lime` (keep pulse dot, now green); REFRESH stays solid accent (`bg-lime text-lime-ink`) — already correct after remap; UPDATED muted. Verify: all tests pass untouched, build clean.

### Task 2 — Sidebar + CityRail light polish
Sidebar: `bg-panel border-r border-hairline` on the aside (white sidebar like the video); active nav pill `bg-lime text-lime-ink` stays (green pill, white text); inactive hover `hover:bg-panel-2`. FLAG stepper card: `border border-hairline bg-panel`. CityRail: cards `rounded-2xl border border-hairline bg-panel shadow-sm`, selected `border-lime ring-1 ring-lime/30`; EdgeBadge chips `bg-up/10 text-up` / `bg-down/10 text-down` (soft chips read correctly on white); top-edges hover `hover:bg-panel-2`.

### Task 3 — KPI hero row + chart/table polish
CityHero becomes a page-header row + three KPI cards (video's signature):
- header row: `<h1>` city name (keeps heading test) + station · date right-aligned;
- card 1 CONSENSUS HIGH: big count-up value (keeps `hero-temp` + count-up effect) + σ chip;
- card 2 BIGGEST EDGE: largest |edge| among unsettled non-agreement rows, value + range label + up/down chip; "—" when none;
- card 3 MODEL HIGHS: NBM/HRRR/GFS values (keeps `hero-models`).
Cards: `rounded-2xl border border-hairline bg-panel p-4 shadow-sm`. Update CityHero.test.tsx for the new structure (keep existing assertion intents).
LadderChart: white card + border; drop both drop-shadow glow filters; gridlines `#e7eae5`; hover tooltip pills stay (gold pill text becomes white on slate). LadderTable: white card + border; prob-bar tracks `bg-panel-2`; edge chips soft green/red.

### Task 4 — Verification/Skill/Help polish + QA
VerificationView/SkillView/HelpPanel: white cards, borders, soft chips (mechanical). Then QA: full vitest + build + Playwright screenshots (chrome channel, 1600×1000@2x, dev 5173 / backend 8000) of all three views + hover states; fix wave for contrast (text-3 on white), chip legibility, shadow subtlety.

## Verification
`cd web && npx vitest run` green; `npm run build` clean; screenshots reviewed; backend untouched.
