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

        // ── PLAYER game screen — every colour is a brand CSS variable ("r g b" triplets set by
        // src/brand/tokens.ts; :root defaults in index.css reproduce the classic look exactly).
        g: {
          bg: 'rgb(var(--g-bg) / <alpha-value>)', bar: 'rgb(var(--g-bar) / <alpha-value>)', panel: 'rgb(var(--g-panel) / <alpha-value>)', inset: 'rgb(var(--g-inset) / <alpha-value>)',
          chip: 'rgb(var(--g-chip) / <alpha-value>)', 'chip-hi': 'rgb(var(--g-chip-hi) / <alpha-value>)', line: 'rgb(var(--g-line) / <alpha-value>)', 'line-hi': 'rgb(var(--g-line-hi) / <alpha-value>)',
          fg: 'rgb(var(--g-fg) / <alpha-value>)', text: 'rgb(var(--g-text) / <alpha-value>)', mute: 'rgb(var(--g-mute) / <alpha-value>)', dim: 'rgb(var(--g-dim) / <alpha-value>)',
          money: 'rgb(var(--g-money) / <alpha-value>)', 'money-bg': 'rgb(var(--g-money-bg) / <alpha-value>)',
          'won-bg': 'rgb(var(--g-won-bg) / <alpha-value>)', 'won-edge': 'rgb(var(--g-won-edge) / <alpha-value>)',
          cta: 'rgb(var(--g-cta) / <alpha-value>)', 'cta-hi': 'rgb(var(--g-cta-hi) / <alpha-value>)', 'cta-lo': 'rgb(var(--g-cta-lo) / <alpha-value>)', 'cta-edge': 'rgb(var(--g-cta-edge) / <alpha-value>)', 'cta-fg': 'rgb(var(--g-cta-fg) / <alpha-value>)',
          accent: 'rgb(var(--g-accent) / <alpha-value>)', 'accent-fg': 'rgb(var(--g-accent-fg) / <alpha-value>)',
          down: 'rgb(var(--g-down) / <alpha-value>)', 'down-hi': 'rgb(var(--g-down-hi) / <alpha-value>)', 'down-edge': 'rgb(var(--g-down-edge) / <alpha-value>)',
          warn: 'rgb(var(--g-warn) / <alpha-value>)', 'warn-hi': 'rgb(var(--g-warn-hi) / <alpha-value>)', 'warn-edge': 'rgb(var(--g-warn-edge) / <alpha-value>)',
          info: 'rgb(var(--g-info) / <alpha-value>)', 'info-hi': 'rgb(var(--g-info-hi) / <alpha-value>)',
        },
        // Older player names, now aliases of the brand variables.
        night: { DEFAULT: 'rgb(var(--g-bg) / <alpha-value>)', deep: 'rgb(var(--g-bg) / <alpha-value>)' },
        panel: { DEFAULT: 'rgb(var(--g-panel) / <alpha-value>)', raised: 'rgb(var(--g-chip) / <alpha-value>)', high: 'rgb(var(--g-chip-hi) / <alpha-value>)' },
        edge: { DEFAULT: 'rgb(var(--g-line) / <alpha-value>)', strong: 'rgb(var(--g-line-hi) / <alpha-value>)' },
        frost: 'rgb(var(--g-fg) / <alpha-value>)',
        win: { DEFAULT: 'rgb(var(--g-cta) / <alpha-value>)', dark: 'rgb(var(--g-cta-lo) / <alpha-value>)' },
        danger: 'rgb(var(--g-accent) / <alpha-value>)',
        info: 'rgb(var(--g-info) / <alpha-value>)',
        funmode: '#c8930a',                                      // Demo balance amber (fixed: "not real money")

        // ── ADMIN theme — Apple dark (macOS / iOS system colours), same family as the player sheets ──
        brand: { DEFAULT: '#0a84ff', dark: '#0071e3' }, // systemBlue: selection, links, primary buttons
        gold: '#ffd60a',   // systemYellow: platform-owner accents
        up: '#30d158',     // systemGreen: money in, success
        down: '#ff453a',   // systemRed: money out, errors, destructive
        ink: '#f5f5f7',    // label
        muted: '#a1a1a6',  // secondary label (~7.9:1 on surface)
        faint: '#86868b',  // tertiary label (~5.1:1 on surface, AA)
        line: '#38383a',   // opaque separator
        canvas: '#000000', // window / grouped background
        surface: '#1c1c1e',// cards (secondarySystemBackground)
        raised: '#2c2c2e', // controls, hover rows, skeletons (tertiarySystemBackground)
        warn: '#ff9f0a',   // systemOrange: needs attention

        // ── PLAYER SHEETS & PAGES: Apple dark system colours (iOS HIG) ──────
        // Everything off the game screen (wallet, sign-in, menu, sheets, profile) uses only these.
        ios: {
          bg: 'rgb(var(--ios-bg) / <alpha-value>)',                  // grouped background
          elev: 'rgb(var(--ios-elev) / <alpha-value>)',              // sheets, grouped cells
          elev2: 'rgb(var(--ios-elev2) / <alpha-value>)',            // cells on sheets, pressed
          elev3: 'rgb(var(--ios-elev3) / <alpha-value>)',
          fill: 'rgba(118,118,128,0.24)',      // tertiarySystemFill: inputs, segmented track
          fill2: 'rgba(118,118,128,0.18)',
          sep: 'rgba(84,84,88,0.65)',
          label: 'rgb(var(--ios-fg) / <alpha-value>)',
          label2: 'rgb(var(--ios-fg2) / 0.6)',
          label3: 'rgb(var(--ios-fg2) / 0.3)',
          green: 'rgb(var(--ios-green) / <alpha-value>)', red: 'rgb(var(--ios-red) / <alpha-value>)', orange: 'rgb(var(--ios-orange) / <alpha-value>)', blue: 'rgb(var(--ios-blue) / <alpha-value>)',
          yellow: '#ffd60a', indigo: '#5e5ce6', pink: '#ff375f', teal: '#40c8e0',
          cta: 'rgb(var(--ios-cta) / <alpha-value>)', 'cta-fg': 'rgb(var(--ios-cta-fg) / <alpha-value>)',
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
      borderRadius: { brand: 'var(--brand-radius)' },
      fontFamily: { title: 'var(--font-title)', body: 'var(--font-body)', mono: 'var(--font-mono)' },
    },
  },
  plugins: [],
};
