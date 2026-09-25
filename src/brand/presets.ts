// ============================================================================
// Seed presets for the palette editor (invest254 lib/brand/presets.ts pattern): a brand theme can
// start from ONE seed colour — derivePalette(seed) builds the whole dark palette around it. Seeds
// are spaced around the hue wheel so neighbouring brands stay easy to tell apart.
// ============================================================================
import type { BrandFont } from './fonts';

export type PresetGroup = 'Warm' | 'Green' | 'Teal' | 'Blue' | 'Violet' | 'Pink' | 'Mono';
export interface SeedPreset { label: string; seed: string; group: PresetGroup; hue: number; fontTitle: BrandFont; fontBody: BrandFont }

export const SEED_PRESETS: readonly SeedPreset[] = [
  { label: 'Ember', seed: '#FF5300', group: 'Warm', hue: 20, fontTitle: 'Rubik', fontBody: 'Inter' },
  { label: 'Tangerine', seed: '#FF9500', group: 'Warm', hue: 35, fontTitle: 'Titillium Web', fontBody: 'Inter' },
  { label: 'Gold', seed: '#F0B90A', group: 'Warm', hue: 46, fontTitle: 'Poppins', fontBody: 'Inter' },
  { label: 'Scarlet', seed: '#FF394A', group: 'Warm', hue: 355, fontTitle: 'Onest', fontBody: 'Inter' },
  { label: 'Lime', seed: '#76B900', group: 'Green', hue: 82, fontTitle: 'Rajdhani', fontBody: 'Inter' },
  { label: 'Fern', seed: '#28A909', group: 'Green', hue: 106, fontTitle: 'Inter', fontBody: 'Inter' },
  { label: 'Mint', seed: '#1ED760', group: 'Green', hue: 141, fontTitle: 'Montserrat', fontBody: 'Inter' },
  { label: 'Spring', seed: '#00E6A0', group: 'Green', hue: 158, fontTitle: 'Space Grotesk', fontBody: 'Inter' },
  { label: 'Lagoon', seed: '#00BEA5', group: 'Teal', hue: 172, fontTitle: 'IBM Plex Sans', fontBody: 'IBM Plex Sans' },
  { label: 'Sky', seed: '#26DDF9', group: 'Teal', hue: 188, fontTitle: 'Exo 2', fontBody: 'Inter' },
  { label: 'Azure', seed: '#008CFF', group: 'Blue', hue: 207, fontTitle: 'DM Sans', fontBody: 'DM Sans' },
  { label: 'Cobalt', seed: '#0052FF', group: 'Blue', hue: 221, fontTitle: 'Sora', fontBody: 'Inter' },
  { label: 'Indigo', seed: '#635BFF', group: 'Blue', hue: 243, fontTitle: 'Hanken Grotesk', fontBody: 'Inter' },
  { label: 'Amethyst', seed: '#8B5CF6', group: 'Violet', hue: 263, fontTitle: 'Space Grotesk', fontBody: 'Inter' },
  { label: 'Magenta', seed: '#FF007A', group: 'Pink', hue: 331, fontTitle: 'Outfit', fontBody: 'Inter' },
  { label: 'Graphite', seed: '#8A8F98', group: 'Mono', hue: 215, fontTitle: 'JetBrains Mono', fontBody: 'Inter' },
];
