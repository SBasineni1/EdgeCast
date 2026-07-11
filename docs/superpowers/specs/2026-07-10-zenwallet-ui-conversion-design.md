# ZenWallet-Style Dashboard UI Conversion — Design

**Date:** 2026-07-10
**Status:** Approved
**Reference:** `frames/f0928218/` — ~788 extracted frames of a "ZenWallet" crypto-dashboard
motion shot (dark charcoal, lime accent, sidebar + main + right rail, count-up numbers,
chart draw-in, staggered reveals).

## Goal

Convert the EdgeCast web dashboard (`web/`) from its current terminal/mono single-column
layout into the reference's three-region layout and visual language, while preserving all
existing data logic, API contracts, polling, and error handling. Frontend-only; no backend
changes.

## Decisions (from brainstorming)

1. **Full layout conversion** — sidebar + main column + right rail.
2. **Cities live in the right rail** (the reference's "Top Assets"/"My Portfolio" region).
   Clicking a city selects it; the main column shows that city's hero, chart, and ladder.
   The sidebar is a product menu, not a city list.
3. **Sidebar = minimal real views** — Dashboard, Verification, Model Skill. Every nav item
   works; no decorative placeholders. Help and the threshold/refresh controls also live in
   the sidebar.
4. **Full ZenWallet visual identity** — lime accent, warm charcoal panels, rounded corners,
   Space Grotesk type.
5. **Full in-UI motion** — entrance timeline, count-up, chart draw-in, staggered reveals,
   micro-interactions. No 3D camera tilt. `prefers-reduced-motion` fully respected.
6. **Chart is hand-rolled SVG** — two probability lines over ~5–7 temperature buckets; no
   chart library. GSAP (already installed) animates it.

## Layout

```
┌──────────┬──────────────────────────────┬─────────────┐
│ Sidebar  │  TopBar (LIVE · updated · ⟳) │             │
│          │  Hero: city name, consensus  │  CityRail   │
│ EDGECAST │  temp (count-up), σ/models   │             │
│          │                              │  City cards │
│ MENU     │  Chart: market vs model      │  (selected  │
│ ▸Dashbrd │  prob across buckets, pill   │  highlight) │
│  Verify  │  labels on line ends         │             │
│  Skill   │                              │  ── ── ──   │
│          │  Ladder table: range, market,│  Top Edges  │
│ OTHER    │  model, edge, consensus mark │  list (all  │
│  Help    │                              │  cities)    │
│ [FLAG ≥] │                              │             │
│ [thresh] │                              │             │
└──────────┴──────────────────────────────┴─────────────┘
```

## Components

New (in `web/src/components/`):

- **`Sidebar`** — brand wordmark, MENU section (Dashboard / Verification / Model Skill nav
  pills; active pill in lime with dark text), OTHER section (Help Center opens the existing
  `HelpPanel`), and the FLAG ≥ threshold stepper at the bottom.
- **`TopBar`** — pulsing live dot + LIVE label, updated-at timestamp, ANALYZING… indicator,
  refresh button. Upstream/input error strips render as a slim banner directly beneath it.
- **`CityHero`** — selected city name, station + event date, consensus high temp as the
  large count-up number (~56–64px, one decimal), per-model highs (NBM/HRRR/GFS) as a
  secondary line.
- **`LadderChart`** — hand-rolled SVG. X-axis: the city's temperature buckets (sorted
  ranges). Two lines: market probability (gold) and model probability (lime), with dashed
  horizontal gridlines, soft line glow, and pill value labels riding the line ends
  (e.g. "MODEL 34%"). Consensus bucket gets a subtle vertical marker when available.
- **`LadderTable`** — restyled ladder rows: range label, market prob + bar, model prob +
  bar, edge chip (▲/▼ with up/down color and glow; "—" for agreement; YES ●/NO once
  settled), consensus marker ▸ on the containing bucket. Kalshi mismatch warnings render
  above the table footer.
- **`CityRail`** — right rail. City cards: name, station, consensus temp, biggest-edge
  badge. Selected card highlighted; click selects the city. Below, a **Top Edges** list of
  flagged edges across all cities (each row: city, range, edge value); clicking a row jumps
  to that city.
- **`VerificationView`** — Kalshi mismatches and settlement/verification failures from
  `output.verification`, as a simple panel list.
- **`SkillView`** — the 30-day model grades (`output.model_grades`), expanded: overall MAE /
  bias / right-bucket per model plus the per-city breakdown and the closest-model verdict
  (content currently in `AggregateStrip` and the CityCard skill accordion).

View switching is plain React state in `App.tsx` (`view: "dashboard" | "verification" |
"skill"`). No router dependency.

Kept as-is: `api.ts`, `types.ts`, polling/threshold/error state logic in `App.tsx`,
`HelpPanel` (restyled only). Removed: `CommandBar`, `CityCard`, `AggregateStrip` (content
relocated as described) and their tests.

## Visual language

Tokens (replace current set in `theme.css`):

- `--color-ink: #0b0d08` — page background, near-black warm olive
- `--color-panel: #151812`, `--color-panel-2: #1c2017` — panels / elevated surfaces
- `--color-lime: #b9f641` — accent: active nav pill, model chart line, pill labels,
  highlights, CTAs. Text on lime fills: `#141609`.
- `--color-gold: #e8c547` — market chart line
- Text scale: `#f2f4ec` / `#a8ad9e` / `#6f7565`
- `--color-up: #4ade80`, `--color-down: #f87171` — edge direction
- Hairlines `rgba(255,255,255,0.08)`; panels `rounded-2xl`, pills/chips `rounded-full`

Type: Space Grotesk everywhere (`@fontsource/space-grotesk` — new dependency, same
fontsource pattern as existing fonts), `tabular-nums` on all data. JetBrains Mono retired.

Texture: subtle radial lime glow behind sidebar top and hero; panels separated by
background shifts rather than borders.

## Motion (GSAP)

Entrance timeline — first data load only (existing `entered` ref pattern):

1. Sidebar items stagger in (x: −12, fade, 0.04s stagger)
2. Hero: city name fades in; consensus temp counts up 0 → value (~0.9s, `power2.out`,
   one decimal, tabular)
3. Chart lines draw in via stroke-dashoffset (~0.8s); pill labels pop (scale 0.8 → 1,
   `back.out`) as each line completes
4. Ladder rows + rail cards stagger (y: 14, fade)

City switch: main column out/in (y: 8, fade, ~0.25s); count-up re-runs from the previous
value to the new value (not from 0); chart redraws; rail highlight moves.

Micro-interactions: nav active pill animates position; live dot keeps pulsing; prob bars
tween width on refresh; 150ms hover transitions (background, edge glow).

Reduced motion: all tweens gated behind the existing `prefers-reduced-motion` check —
instant final states, no animation.

## Edge cases

- **SIGNAL LOST** full-screen state, **UPSTREAM UNREACHABLE / PARTIAL** strips, **INPUT
  ERROR**, `busy` dimming, and 60s polling: logic unchanged; strips restyled as a slim
  banner under the TopBar.
- **Selected city fallback:** default selection is the first city alphabetically. If the
  selected city disappears from results (upstream partial), fall back to the first
  available city rather than rendering an empty main column.
- **No grades:** SkillView and hero show the "run: uv run edgecast backfill" hint (current
  behavior, relocated).
- **No consensus:** hero shows "—"; chart omits the consensus marker; table omits ▸.

## Testing

- Replace removed component tests with: `CityRail` (renders cities, selection callback,
  selected highlight, top-edges jump), `LadderTable` (row rendering, edge cells —
  up/down/agreement/settled, consensus marker; port assertions from `CityCard.test.tsx`),
  `Sidebar` (threshold stepper bounds/steps, view switching, help toggle), and an `App`
  test covering city selection + fallback when the selected city vanishes.
- `LadderChart`: smoke test that it renders paths/labels for given results (no animation
  assertions).
- GSAP stays out of assertions; jsdom + reduced-motion default true (current pattern).
- Existing `api.test.ts` and App error-state tests remain valid.

## Out of scope

- Backend/API changes of any kind (no time-series endpoint; the chart uses the existing
  per-bucket probabilities).
- Routing library, chart library, or any dependency beyond `@fontsource/space-grotesk`.
- The reference video's 3D camera zoom/tilt entrance.
- New data features (history, settings persistence, additional views).
