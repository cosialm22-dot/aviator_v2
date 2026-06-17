/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── DESIGN SYSTEM ───────────────────────────────────────────────────
        // This product ships TWO intentional, named theme scopes (not a single
        // theme). Both are first-class tokens so styling stays single-source and
        // there is no ambiguity about which palette a surface belongs to:
        //   • PLAYER app  → dark theme  (night/panel/edge/frost/win/danger)
        //   • ADMIN app   → light theme (canvas/surface/ink/muted/line/brand…)
        // The root <body> uses the dark player tokens (see index.css); admin
        // shells opt into the light tokens via bg-canvas/text-ink. Token VALUES
        // mirror the previously hardcoded hex exactly, so naming them is a pure
        // refactor with zero visual change.

        // ── PLAYER (dark) theme ─────────────────────────────────────────────
        night: { DEFAULT: '#0d0d1a', deep: '#0a0a14' },          // page background
        panel: { DEFAULT: '#11111f', raised: '#1a1a2e', high: '#1e1e30' }, // dark cards/panels
        edge: { DEFAULT: '#2a2a45', strong: '#2a3150' },         // dark hairline borders
        frost: '#e2e8f0',                                        // dark-theme primary text
        win: { DEFAULT: '#22c55e', dark: '#16a34a' },            // success / primary CTA green
        danger: '#c8001c',                                       // player brand-red accent

        // ── ADMIN (light) theme — institutional base + trading semantics ────
        brand: { DEFAULT: '#015d72', dark: '#013e4c' }, // deep teal-navy (structure/nav)
        gold: '#e0a80b',   // vivid accent (Binance-leaning); fills only
        up: '#0ecb81',     // gains / win  (Binance green)
        down: '#f6465d',   // loss / fault (Binance red)
        ink: '#1b2a31',    // primary text   (~13:1 on white)
        muted: '#566169',  // secondary text (~5.4:1 on white, AA)
        faint: '#8a949b',  // labels/empty-state only - never body text
        line: '#e9ebee',   // hairline borders
        canvas: '#f7f8fa', // page background
        surface: '#ffffff',// card background
      },
    },
  },
  plugins: [],
};
