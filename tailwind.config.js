/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Light, institutional base (Walden) with Binance-style trading semantics.
        // Semantic tokens — referenced by name in JSX so restyling stays single-source.
        brand: { DEFAULT: '#015d72', dark: '#013e4c' }, // deep teal-navy (structure/nav)
        gold: '#e0a80b',   // vivid accent (Binance-leaning); fills only
        up: '#0ecb81',     // gains / win  (Binance green)
        down: '#f6465d',   // loss / fault (Binance red)
        ink: '#1b2a31',    // primary text   (~13:1 on white)
        muted: '#566169',  // secondary text (~5.4:1 on white, AA)
        faint: '#8a949b',  // labels/empty-state only — never body text
        line: '#e9ebee',   // hairline borders
        canvas: '#f7f8fa', // page background
        surface: '#ffffff',// card background
      },
    },
  },
  plugins: [],
};
