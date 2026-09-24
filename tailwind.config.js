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
        //   • ADMIN app   → dark theme  (canvas/surface/ink/muted/line/brand…)
        // Both scopes are dark. The root <body> uses the player tokens (see
        // index.css); admin shells opt into the admin scope via bg-canvas/text-ink.
        // The two scopes stay SEPARATE tokens because the admin keeps its own
        // institutional teal brand + trading up/down semantics, distinct from the
        // player palette.

        // ── PLAYER (dark) theme ─────────────────────────────────────────────
        night: { DEFAULT: '#1b1b1b', deep: '#141414' },          // page background
        panel: { DEFAULT: '#1b1b1b', raised: '#262626', high: '#2c2c2c' }, // dark cards/panels
        edge: { DEFAULT: '#333333', strong: '#3a3a3a' },         // dark hairline borders
        frost: '#e8e8e8',                                        // dark-theme primary text
        win: { DEFAULT: '#28a745', dark: '#1f8a3a' },            // success / primary CTA green (Bet button)
        danger: '#e51e3c',                                       // player brand-red accent (plane/trail/logo)
        info: '#17a2b8',                                         // player accent-blue (referrals/marketing)
        funmode: '#c8930a',                                      // FUN MODE banner amber

        // ── ADMIN (dark) theme — institutional base + trading semantics ────
        brand: { DEFAULT: '#1f9bb8', dark: '#013e4c' }, // teal accent (links/active/buttons); -dark is the deep sidebar/hover teal
        gold: '#e0a80b',   // vivid accent; fills only (reads well on dark)
        up: '#0ecb81',     // gains / win  (reads well on dark)
        down: '#f6465d',   // loss / fault (reads well on dark)
        ink: '#e6eaf0',    // primary text   (~15:1 on canvas)
        muted: '#9aa6b2',  // secondary text (~8:1 on canvas, AA)
        faint: '#828c97',  // labels/empty-state (~5.4:1 on canvas)
        line: '#26303c',   // hairline borders
        canvas: '#0b0f14', // page background (dark)
        surface: '#141b24',// card background (dark, lifted from canvas)
        raised: '#1b2430', // controls / hover rows / skeletons (one step above surface)
        warn: '#f0b90b',   // needs attention (amber)
      },
    },
  },
  plugins: [],
};
