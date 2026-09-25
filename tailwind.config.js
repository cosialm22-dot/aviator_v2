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

        // ── PLAYER SHEETS & PAGES: Apple dark system colours (iOS HIG) ──────
        // Everything off the game screen (wallet, sign-in, menu, sheets, profile) uses only these.
        ios: {
          bg: '#000000',                       // systemBackground / grouped background
          elev: '#1c1c1e',                     // secondarySystemBackground: sheets, grouped cells
          elev2: '#2c2c2e',                    // tertiarySystemBackground: cells on sheets, pressed
          elev3: '#3a3a3c',
          fill: 'rgba(118,118,128,0.24)',      // tertiarySystemFill: inputs, segmented track
          fill2: 'rgba(118,118,128,0.18)',     // quaternarySystemFill
          sep: 'rgba(84,84,88,0.65)',          // separator (hairline)
          label: '#ffffff',
          label2: 'rgba(235,235,245,0.6)',     // secondaryLabel
          label3: 'rgba(235,235,245,0.3)',     // tertiaryLabel
          green: '#30d158', red: '#ff453a', orange: '#ff9f0a', blue: '#0a84ff', yellow: '#ffd60a', indigo: '#5e5ce6', pink: '#ff375f', teal: '#40c8e0',
          cta: '#28a909',                      // the game's Bet green, for primary buttons
        },
      },
      // iOS text styles (Large, default Dynamic Type): size / line height / tracking / weight.
      fontSize: {
        'large-title': ['34px', { lineHeight: '41px', letterSpacing: '0.37px', fontWeight: '700' }],
        title1: ['28px', { lineHeight: '34px', letterSpacing: '0.36px', fontWeight: '700' }],
        title2: ['22px', { lineHeight: '28px', letterSpacing: '0.35px', fontWeight: '700' }],
        title3: ['20px', { lineHeight: '25px', letterSpacing: '0.38px', fontWeight: '600' }],
        headline: ['17px', { lineHeight: '22px', letterSpacing: '-0.43px', fontWeight: '600' }],
        body: ['17px', { lineHeight: '22px', letterSpacing: '-0.43px' }],
        callout: ['16px', { lineHeight: '21px', letterSpacing: '-0.31px' }],
        subhead: ['15px', { lineHeight: '20px', letterSpacing: '-0.23px' }],
        footnote: ['13px', { lineHeight: '18px', letterSpacing: '-0.08px' }],
        caption1: ['12px', { lineHeight: '16px', letterSpacing: '0px' }],
        caption2: ['11px', { lineHeight: '13px', letterSpacing: '0.07px' }],
      },
      transitionTimingFunction: { ios: 'cubic-bezier(0.32, 0.72, 0, 1)' },
    },
  },
  plugins: [],
};
