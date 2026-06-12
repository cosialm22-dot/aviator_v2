/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Walden-inspired institutional palette (light theme).
        // Semantic tokens — referenced by name in JSX so restyling stays single-source.
        brand: { DEFAULT: '#015d72', dark: '#013e4c', tint: '#e8f1f3' }, // deep teal-navy
        gold: { DEFAULT: '#b5821f', tint: '#f6efdd' },                    // mustard accent
        ink: '#1b2a31',      // primary text  (~13:1 on white)
        muted: '#566169',    // secondary text/labels (~5.4:1 on white, AA)
        faint: '#8a949b',    // decorative/empty-state only — never body text
        line: '#e6e9e7',     // hairline borders
        canvas: '#f4f6f5',   // page background
        surface: '#ffffff',  // card background
      },
    },
  },
  plugins: [],
};
