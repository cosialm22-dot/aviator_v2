// ============================================================================
// Brand looks — complete, original identities for marketer sites (the invest254 siteThemes idea,
// rebuilt for a crash game). A look is more than a palette: it sets the theme tokens (surfaces,
// text, call-to-action, fonts, weight, radius), the game screen (sky style and colours, flight line,
// countdown, multiplier, fly-away colour), the plane (model + colours) and the streamer bird.
// Applying one writes theme_tokens + those settings in ONE versioned save; every field stays
// editable afterwards. `classic` reproduces today's look exactly.
// ============================================================================
import type { ThemeTokens } from './tokens';
import { CLASSIC_TOKENS } from './tokens';
import type { PlaneModel } from './planes';

export interface BrandLook {
  id: string;
  label: string;
  tokens: ThemeTokens;
  canvas: { style: 'sunburst' | 'rays' | 'grid' | 'stars' | 'plain'; bg: string; ray: string; curve: string; wait: string; multiplier: string; crash: string };
  plane: { model: PlaneModel; body: string; accent: string; canopy: string };
  bird: string;
}

const SEM = { up: '#34d058', down: '#ff4757', warn: '#ff9f0a', info: '#3b82f6' };
type T = Omit<ThemeTokens, 'up' | 'down' | 'warn' | 'info'> & Partial<Pick<ThemeTokens, 'up' | 'down' | 'warn' | 'info'>>;
const tk = (t: T): ThemeTokens => ({ ...SEM, ...t });

export const BRAND_LOOKS: BrandLook[] = [
  { id: 'classic', label: 'Classic Red', tokens: CLASSIC_TOKENS,
    canvas: { style: 'sunburst', bg: '#0d0d0d', ray: '#1e1e1e', curve: '#e51e3c', wait: '#e8123c', multiplier: '#ffffff', crash: '#e51e3c' },
    plane: { model: 'classic', body: '#e51e3c', accent: '#b3122e', canopy: '#bfe6ff' }, bird: 'fisheagle' },
  { id: 'midnight-gold', label: 'Midnight Gold',
    tokens: tk({ bg: '#0b0b10', surface: '#16161f', surface2: '#22222e', border: '#2c2c3a', fg: '#f5f3ea', muted: '#9a98a8', brand: '#f0b90b', brandHover: '#c99a08', brandText: '#ffd24a', accent: '#ffd24a', accentFg: '#0b0f14', fontTitle: 'Poppins', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '800', radius: '10px' }),
    canvas: { style: 'rays', bg: '#0b0b12', ray: '#17171f', curve: '#f0b90b', wait: '#f0b90b', multiplier: '#fff6d6', crash: '#ff4757' },
    plane: { model: 'jet', body: '#f0b90b', accent: '#7a5a00', canopy: '#d6f0ff' }, bird: 'crownedcrane' },
  { id: 'emerald-safari', label: 'Emerald Safari',
    tokens: tk({ bg: '#07130d', surface: '#0e2118', surface2: '#163226', border: '#1f4232', fg: '#eafff3', muted: '#8fb3a1', brand: '#22c55e', brandHover: '#16a34a', brandText: '#86efac', accent: '#86efac', accentFg: '#0b0f14', up: '#4ade80', fontTitle: 'Montserrat', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '800', radius: '12px' }),
    canvas: { style: 'grid', bg: '#06110b', ray: '#0c1d14', curve: '#22c55e', wait: '#22c55e', multiplier: '#eafff3', crash: '#ff4757' },
    plane: { model: 'prop', body: '#16a34a', accent: '#065f46', canopy: '#d1fae5' }, bird: 'fisheagle' },
  { id: 'ocean-blue', label: 'Ocean Blue',
    tokens: tk({ bg: '#06101f', surface: '#0c1a30', surface2: '#132642', border: '#1d3456', fg: '#eaf3ff', muted: '#8ea6c4', brand: '#0a84ff', brandHover: '#0070dd', brandText: '#5ac8fa', accent: '#5ac8fa', accentFg: '#0b0f14', fontTitle: 'Sora', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '700', radius: '14px' }),
    canvas: { style: 'rays', bg: '#050e1c', ray: '#0b1830', curve: '#0a84ff', wait: '#0a84ff', multiplier: '#eaf3ff', crash: '#ff4757' },
    plane: { model: 'concorde', body: '#e8f1ff', accent: '#0a84ff', canopy: '#9fd8ff' }, bird: 'albatross' },
  { id: 'violet-night', label: 'Violet Night',
    tokens: tk({ bg: '#0d0816', surface: '#170f26', surface2: '#221737', border: '#2f2149', fg: '#f4efff', muted: '#a497c2', brand: '#8b5cf6', brandHover: '#7c3aed', brandText: '#c4b5fd', accent: '#c4b5fd', accentFg: '#0b0f14', fontTitle: 'Space Grotesk', fontBody: 'Inter', fontMono: 'JetBrains Mono', headingWeight: '700', radius: '12px' }),
    canvas: { style: 'stars', bg: '#0b0714', ray: '#1a1030', curve: '#a855f7', wait: '#8b5cf6', multiplier: '#f4efff', crash: '#ff4757' },
    plane: { model: 'stealth', body: '#3b1d7a', accent: '#a855f7', canopy: '#e9d5ff' }, bird: 'roller' },
  { id: 'neon-pink', label: 'Neon Pink',
    tokens: tk({ bg: '#120510', surface: '#1f0a1b', surface2: '#2c1027', border: '#3d1636', fg: '#ffeefa', muted: '#c39bb8', brand: '#ff2d95', brandHover: '#e0157a', brandText: '#ff7ac4', accent: '#ff7ac4', accentFg: '#0b0f14', fontTitle: 'Outfit', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '800', radius: '16px' }),
    canvas: { style: 'rays', bg: '#10040e', ray: '#1f0a1c', curve: '#ff2d95', wait: '#ff2d95', multiplier: '#ffeefa', crash: '#ffcc00' },
    plane: { model: 'fighter', body: '#ff2d95', accent: '#7a0d45', canopy: '#ffe0f1' }, bird: 'flamingo' },
  { id: 'sunset-orange', label: 'Sunset',
    tokens: tk({ bg: '#140a05', surface: '#22120a', surface2: '#301a0f', border: '#422516', fg: '#fff4ec', muted: '#c8a893', brand: '#ff6a13', brandHover: '#e0560a', brandText: '#ffa24a', accent: '#ffa24a', accentFg: '#0b0f14', fontTitle: 'Rubik', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '800', radius: '12px' }),
    canvas: { style: 'sunburst', bg: '#130904', ray: '#22120a', curve: '#ff6a13', wait: '#ff6a13', multiplier: '#fff4ec', crash: '#ff4757' },
    plane: { model: 'biplane', body: '#ff6a13', accent: '#7c2d12', canopy: '#ffe4cc' }, bird: 'weaver' },
  { id: 'arctic-teal', label: 'Arctic Teal',
    tokens: tk({ bg: '#041314', surface: '#0a2123', surface2: '#103033', border: '#174246', fg: '#e6fffd', muted: '#86b5b2', brand: '#14b8a6', brandHover: '#0d9488', brandText: '#5eead4', accent: '#5eead4', accentFg: '#0b0f14', fontTitle: 'Manrope', fontBody: 'Manrope', fontMono: 'Inter', headingWeight: '800', radius: '14px' }),
    canvas: { style: 'grid', bg: '#031012', ray: '#0a2123', curve: '#2dd4bf', wait: '#14b8a6', multiplier: '#e6fffd', crash: '#ff4757' },
    plane: { model: 'seaplane', body: '#f0fdfa', accent: '#0f766e', canopy: '#99f6e4' }, bird: 'heron' },
  { id: 'royal-crimson', label: 'Royal Crimson',
    tokens: tk({ bg: '#12060a', surface: '#1f0c12', surface2: '#2c121b', border: '#3d1825', fg: '#fff0f3', muted: '#c49aa5', brand: '#e11d48', brandHover: '#be123c', brandText: '#fb7185', accent: '#fbbf24', accentFg: '#0b0f14', fontTitle: 'Fraunces', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '700', radius: '8px' }),
    canvas: { style: 'sunburst', bg: '#10050a', ray: '#1e0b12', curve: '#e11d48', wait: '#fbbf24', multiplier: '#fff0f3', crash: '#fbbf24' },
    plane: { model: 'jet', body: '#be123c', accent: '#fbbf24', canopy: '#ffe4e6' }, bird: 'augur' },
  { id: 'carbon-lime', label: 'Carbon Lime',
    tokens: tk({ bg: '#0a0c06', surface: '#14180c', surface2: '#1e2412', border: '#2a3319', fg: '#f6ffe6', muted: '#a3b38a', brand: '#a3e635', brandHover: '#84cc16', brandText: '#d9f99d', accent: '#d9f99d', accentFg: '#0b0f14', fontTitle: 'Rajdhani', fontBody: 'Inter', fontMono: 'JetBrains Mono', headingWeight: '700', radius: '4px' }),
    canvas: { style: 'grid', bg: '#090b05', ray: '#141a0c', curve: '#a3e635', wait: '#a3e635', multiplier: '#f6ffe6', crash: '#ff4757' },
    plane: { model: 'rocket', body: '#e4e4e7', accent: '#65a30d', canopy: '#d9f99d' }, bird: 'falcon' },
  { id: 'steel-mono', label: 'Steel',
    tokens: tk({ bg: '#0b0c0e', surface: '#15171a', surface2: '#1f2226', border: '#2b2f34', fg: '#f2f4f7', muted: '#9aa1ab', brand: '#e5e7eb', brandHover: '#cbd5e1', brandText: '#ffffff', accent: '#9ca3af', accentFg: '#0b0f14', fontTitle: 'JetBrains Mono', fontBody: 'Inter', fontMono: 'JetBrains Mono', headingWeight: '700', radius: '6px' }),
    canvas: { style: 'plain', bg: '#0b0c0e', ray: '#15171a', curve: '#e5e7eb', wait: '#e5e7eb', multiplier: '#ffffff', crash: '#ff4757' },
    plane: { model: 'stealth', body: '#374151', accent: '#9ca3af', canopy: '#e5e7eb' }, bird: 'osprey' },
  { id: 'savanna-amber', label: 'Savanna',
    tokens: tk({ bg: '#120d04', surface: '#1f1708', surface2: '#2c210c', border: '#3d2e12', fg: '#fff8e8', muted: '#c7b48c', brand: '#f59e0b', brandHover: '#d97706', brandText: '#fcd34d', accent: '#fcd34d', accentFg: '#0b0f14', fontTitle: 'Barlow', fontBody: 'Barlow', fontMono: 'Inter', headingWeight: '800', radius: '10px' }),
    canvas: { style: 'sunburst', bg: '#110c04', ray: '#1f1708', curve: '#f59e0b', wait: '#f59e0b', multiplier: '#fff8e8', crash: '#ff4757' },
    plane: { model: 'cargo', body: '#d97706', accent: '#78350f', canopy: '#fef3c7' }, bird: 'crownedcrane' },
  { id: 'cobalt-sky', label: 'Cobalt Sky',
    tokens: tk({ bg: '#050b1a', surface: '#0b1530', surface2: '#122045', border: '#1b2d5c', fg: '#eef4ff', muted: '#91a3c8', brand: '#2563eb', brandHover: '#1d4ed8', brandText: '#93c5fd', accent: '#60a5fa', accentFg: '#0b0f14', fontTitle: 'Plus Jakarta Sans', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '800', radius: '14px' }),
    canvas: { style: 'stars', bg: '#040a18', ray: '#0b1530', curve: '#60a5fa', wait: '#2563eb', multiplier: '#eef4ff', crash: '#ff4757' },
    plane: { model: 'glider', body: '#ffffff', accent: '#2563eb', canopy: '#bfdbfe' }, bird: 'swift' },
  { id: 'ruby-rush', label: 'Ruby Rush',
    tokens: tk({ bg: '#0f0507', surface: '#1c0a0e', surface2: '#281015', border: '#3a161e', fg: '#fff1f2', muted: '#c89aa1', brand: '#ff3b30', brandHover: '#e0261c', brandText: '#ff8a80', accent: '#ff9f0a', accentFg: '#0b0f14', fontTitle: 'Russo One', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '400', radius: '10px' }),
    canvas: { style: 'rays', bg: '#0e0406', ray: '#1c0a0e', curve: '#ff3b30', wait: '#ff9f0a', multiplier: '#fff1f2', crash: '#ff9f0a' },
    plane: { model: 'fighter', body: '#ff3b30', accent: '#1c0a0e', canopy: '#ffd7d4' }, bird: 'sunbird' },
  { id: 'jade-dragon', label: 'Jade Dragon',
    tokens: tk({ bg: '#03110c', surface: '#082017', surface2: '#0e2e21', border: '#153d2d', fg: '#ecfff6', muted: '#8cb8a5', brand: '#10b981', brandHover: '#059669', brandText: '#6ee7b7', accent: '#fbbf24', accentFg: '#0b0f14', fontTitle: 'Orbitron', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '800', radius: '8px' }),
    canvas: { style: 'sunburst', bg: '#030f0b', ray: '#082017', curve: '#10b981', wait: '#fbbf24', multiplier: '#ecfff6', crash: '#fbbf24' },
    plane: { model: 'concorde', body: '#10b981', accent: '#fbbf24', canopy: '#d1fae5' }, bird: 'bee-eater' },
  { id: 'electric-cyan', label: 'Electric Cyan',
    tokens: tk({ bg: '#020d12', surface: '#061a22', surface2: '#0b2733', border: '#113645', fg: '#e8fbff', muted: '#86b0bd', brand: '#06b6d4', brandHover: '#0891b2', brandText: '#67e8f9', accent: '#22d3ee', accentFg: '#0b0f14', fontTitle: 'Exo 2', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '800', radius: '12px' }),
    canvas: { style: 'stars', bg: '#020b10', ray: '#061a22', curve: '#22d3ee', wait: '#06b6d4', multiplier: '#e8fbff', crash: '#ff4757' },
    plane: { model: 'rocket', body: '#e8fbff', accent: '#06b6d4', canopy: '#a5f3fc' }, bird: 'martin' },
  { id: 'rose-gold', label: 'Rose Gold',
    tokens: tk({ bg: '#120b0b', surface: '#1e1414', surface2: '#2a1c1c', border: '#3a2828', fg: '#fff5f2', muted: '#c4a7a1', brand: '#e8a598', brandHover: '#d98b7c', brandText: '#f5d0c5', accent: '#f5d0c5', accentFg: '#0b0f14', fontTitle: 'Lora', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '600', radius: '18px' }),
    canvas: { style: 'rays', bg: '#110a0a', ray: '#1e1414', curve: '#e8a598', wait: '#e8a598', multiplier: '#fff5f2', crash: '#ff4757' },
    plane: { model: 'glider', body: '#f5d0c5', accent: '#b76e5d', canopy: '#fff5f2' }, bird: 'flamingo' },
  { id: 'lava', label: 'Lava',
    tokens: tk({ bg: '#100604', surface: '#1d0c07', surface2: '#2a120b', border: '#3b1a10', fg: '#fff3ec', muted: '#c9a291', brand: '#ff4500', brandHover: '#e03d00', brandText: '#ffb347', accent: '#ffb347', accentFg: '#0b0f14', fontTitle: 'Teko', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '600', radius: '6px' }),
    canvas: { style: 'sunburst', bg: '#0f0503', ray: '#200d07', curve: '#ff4500', wait: '#ffb347', multiplier: '#fff3ec', crash: '#ffb347' },
    plane: { model: 'rocket', body: '#ff4500', accent: '#2a120b', canopy: '#ffe0cc' }, bird: 'vulture' },
  { id: 'aurora', label: 'Aurora',
    tokens: tk({ bg: '#040b14', surface: '#0a1626', surface2: '#102137', border: '#182d48', fg: '#eefcf7', muted: '#8fb0bf', brand: '#34d399', brandHover: '#10b981', brandText: '#a7f3d0', accent: '#a78bfa', accentFg: '#0b0f14', fontTitle: 'Sora', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '700', radius: '16px' }),
    canvas: { style: 'stars', bg: '#030a12', ray: '#0a1626', curve: '#34d399', wait: '#a78bfa', multiplier: '#eefcf7', crash: '#ff4757' },
    plane: { model: 'stealth', body: '#1e3a5f', accent: '#34d399', canopy: '#a78bfa' }, bird: 'starling' },
  { id: 'sahara-sand', label: 'Sahara',
    tokens: tk({ bg: '#14110b', surface: '#211c13', surface2: '#2d261a', border: '#3d3423', fg: '#fffaf0', muted: '#c2b59b', brand: '#d4a373', brandHover: '#bc8a5f', brandText: '#e9c46a', accent: '#e9c46a', accentFg: '#0b0f14', fontTitle: 'Outfit', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '700', radius: '12px' }),
    canvas: { style: 'sunburst', bg: '#13100a', ray: '#211c13', curve: '#d4a373', wait: '#e9c46a', multiplier: '#fffaf0', crash: '#ff4757' },
    plane: { model: 'biplane', body: '#e9c46a', accent: '#8a5a2b', canopy: '#fffaf0' }, bird: 'sparrow' },
  { id: 'navy-silver', label: 'Navy Silver',
    tokens: tk({ bg: '#070b14', surface: '#0f1624', surface2: '#172033', border: '#222d44', fg: '#f1f5f9', muted: '#94a3b8', brand: '#c0c7d4', brandHover: '#a8b0bf', brandText: '#e2e8f0', accent: '#7dd3fc', accentFg: '#0b0f14', fontTitle: 'IBM Plex Sans', fontBody: 'IBM Plex Sans', fontMono: 'IBM Plex Mono', headingWeight: '700', radius: '8px' }),
    canvas: { style: 'grid', bg: '#060a12', ray: '#0f1624', curve: '#7dd3fc', wait: '#c0c7d4', multiplier: '#f1f5f9', crash: '#ff4757' },
    plane: { model: 'jet', body: '#e2e8f0', accent: '#1e3a8a', canopy: '#7dd3fc' }, bird: 'albatross' },
  { id: 'matrix', label: 'Matrix',
    tokens: tk({ bg: '#020803', surface: '#06140a', surface2: '#0b2011', border: '#123019', fg: '#e6ffe9', muted: '#7fb38a', brand: '#00e05a', brandHover: '#00b84a', brandText: '#6bff9e', accent: '#00cc52', accentFg: '#0b0f14', fontTitle: 'Space Mono', fontBody: 'Inter', fontMono: 'Space Mono', headingWeight: '700', radius: '2px' }),
    canvas: { style: 'grid', bg: '#020703', ray: '#06140a', curve: '#00e05a', wait: '#00e05a', multiplier: '#e6ffe9', crash: '#ff4757' },
    plane: { model: 'stealth', body: '#0b2011', accent: '#00e05a', canopy: '#6bff9e' }, bird: 'swallow' },
  { id: 'candy', label: 'Candy',
    tokens: tk({ bg: '#140816', surface: '#22102a', surface2: '#2f173a', border: '#40204e', fg: '#fff0fb', muted: '#c4a0c5', brand: '#f472b6', brandHover: '#ec4899', brandText: '#f9a8d4', accent: '#a78bfa', accentFg: '#0b0f14', fontTitle: 'Figtree', fontBody: 'Figtree', fontMono: 'Inter', headingWeight: '800', radius: '20px' }),
    canvas: { style: 'stars', bg: '#120714', ray: '#22102a', curve: '#f472b6', wait: '#a78bfa', multiplier: '#fff0fb', crash: '#fbbf24' },
    plane: { model: 'prop', body: '#f472b6', accent: '#a78bfa', canopy: '#fff0fb' }, bird: 'sunbird' },
  { id: 'heritage', label: 'Heritage',
    tokens: tk({ bg: '#0b0b0b', surface: '#171717', surface2: '#232323', border: '#2f2f2f', fg: '#fafafa', muted: '#a3a3a3', brand: '#009a44', brandHover: '#007a36', brandText: '#4ade80', accent: '#d21034', accentFg: '#ffffff', fontTitle: 'Oswald', fontBody: 'Inter', fontMono: 'Inter', headingWeight: '700', radius: '8px' }),
    canvas: { style: 'sunburst', bg: '#0a0a0a', ray: '#181818', curve: '#d21034', wait: '#009a44', multiplier: '#fafafa', crash: '#d21034' },
    plane: { model: 'cargo', body: '#fafafa', accent: '#009a44', canopy: '#d21034' }, bird: 'fisheagle' },
];

export const LOOK_MAP: Record<string, BrandLook> = Object.fromEntries(BRAND_LOOKS.map((l) => [l.id, l]));

/** The settings a look writes (alongside its theme tokens) in one save. */
export function lookToConfig(l: BrandLook): Record<string, string | boolean | number> {
  return {
    'look.theme_id': l.id,
    'look.canvas_style': l.canvas.style, 'look.canvas_bg': l.canvas.bg, 'look.canvas_ray': l.canvas.ray,
    'look.curve': l.canvas.curve, 'look.wait_bar': l.canvas.wait, 'look.multiplier': l.canvas.multiplier, 'look.crash': l.canvas.crash,
    'plane.model': l.plane.model, 'plane.body': l.plane.body, 'plane.accent': l.plane.accent, 'plane.canopy': l.plane.canopy,
    'stream.bird': l.bird,
  };
}
