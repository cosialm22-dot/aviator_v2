// ============================================================================
// Procedural animated birds — 20 distinct species, each a parameterized vector
// model rendered + flapped on the canvas. No image assets: every bird is drawn
// from its spec each frame, so it flaps smoothly at 60fps and scales crisply.
//
// Model (side profile, facing +x / right):
//   • fuselage  — an ellipse-ish body, length L, height H (species-dependent)
//   • head+beak — a circle at the front + a beak wedge (shape per archetype)
//   • tail      — forked / wedge / fan / long, at the rear
//   • wing      — TWO segments (arm + hand) hinged at the shoulder; the pair
//                 rotates around the shoulder by the flap cycle. Wing shape
//                 (short/pointed vs broad/fingered) is per-archetype.
//
// Flap cycle: wingAngle(t) = -glide + amp * sin(2π · rate · t). `glide` raises
// the wing baseline for soarers (long glide, few flaps); `amp`/`rate` set the
// flap depth + speed. A `glideRatio` (0..1) holds the wing up for a fraction of
// each cycle to read as a glide for soaring birds.
//
// All drawing is in a normalised local space where the body length = 100 units,
// centred on the shoulder pivot; the caller scales to pixels. Facing right.
// ============================================================================

export type WingShape = 'pointed' | 'broad' | 'rounded' | 'long';
export type TailShape = 'forked' | 'wedge' | 'fan' | 'long' | 'streamer';
export type Archetype = 'swift' | 'soar' | 'song' | 'exotic';

export interface BirdSpec {
  id: string;
  label: string;
  archetype: Archetype;
  // palette
  body: string; belly: string; wing: string; wingTip: string;
  tail: string; head: string; beak: string; accent?: string; legs?: string;
  // geometry (body length = 100 units baseline)
  bodyLen: number;   // fuselage length
  bodyH: number;     // fuselage height
  headR: number;     // head radius
  beakLen: number;   // beak length
  wingLen: number;   // wing hand length
  wingShape: WingShape;
  tailShape: TailShape;
  tailLen: number;
  longLegs?: boolean;  // trailing legs (heron/crane/flamingo)
  crest?: boolean;     // head crest (crowned crane)
  // flight character
  flapRate: number;    // flaps per second
  flapAmp: number;     // wing rotation amplitude (radians)
  glide: number;       // baseline wing raise (radians, + = up)
  glideRatio: number;  // fraction of cycle spent gliding (0..1)
  size: number;        // relative render scale (1 = default)
}

// ── The 20 species ───────────────────────────────────────────────────────────
export const BIRDS: BirdSpec[] = [
  // ── SWIFT archetype: sleek, fast, forked/pointed, rapid small flaps ──
  { id:'swift',    label:'African Swift',      archetype:'swift', body:'#3b4252', belly:'#d8dee9', wing:'#2e3440', wingTip:'#4c566a', tail:'#2e3440', head:'#3b4252', beak:'#2b2118', bodyLen:100, bodyH:26, headR:11, beakLen:9,  wingLen:62, wingShape:'pointed', tailShape:'forked', tailLen:34, flapRate:7.5, flapAmp:0.9, glide:0.15, glideRatio:0.1, size:0.9 },
  { id:'swallow',  label:'Barn Swallow',       archetype:'swift', body:'#1f3a93', belly:'#f4ecd8', wing:'#16265e', wingTip:'#2b4bb5', tail:'#16265e', head:'#8a2b12', beak:'#2b2118', bodyLen:96,  bodyH:24, headR:11, beakLen:8,  wingLen:60, wingShape:'pointed', tailShape:'forked', tailLen:40, flapRate:8.0, flapAmp:0.95, glide:0.1, glideRatio:0.08, size:0.85 },
  { id:'falcon',   label:'Peregrine Falcon',   archetype:'swift', body:'#4a4e57', belly:'#e8e6df', wing:'#33363d', wingTip:'#5c6169', tail:'#33363d', head:'#20232a', beak:'#e0a80b', bodyLen:104, bodyH:30, headR:12, beakLen:11, wingLen:66, wingShape:'pointed', tailShape:'wedge',  tailLen:30, flapRate:6.5, flapAmp:0.85, glide:0.2, glideRatio:0.15, size:1.0 },
  { id:'martin',   label:'Sand Martin',        archetype:'swift', body:'#7a5c3e', belly:'#f1e9dc', wing:'#5d4429', wingTip:'#8a6b4a', tail:'#5d4429', head:'#7a5c3e', beak:'#2b2118', bodyLen:92,  bodyH:23, headR:10, beakLen:8,  wingLen:56, wingShape:'pointed', tailShape:'forked', tailLen:30, flapRate:8.5, flapAmp:0.9, glide:0.1, glideRatio:0.08, size:0.8 },
  { id:'bee-eater',label:'Little Bee-eater',   archetype:'swift', body:'#2fbf71', belly:'#f6d743', wing:'#1d8a52', wingTip:'#f2994a', tail:'#1d8a52', head:'#f2994a', beak:'#20232a', bodyLen:94,  bodyH:24, headR:11, beakLen:14, wingLen:54, wingShape:'pointed', tailShape:'streamer', tailLen:38, flapRate:7.0, flapAmp:0.9, glide:0.12, glideRatio:0.1, size:0.85 },

  // ── SOAR archetype: broad fingered wings, slow powerful flaps + glide ──
  { id:'fisheagle',label:'African Fish Eagle', archetype:'soar', body:'#5a3a22', belly:'#f4f1ea', wing:'#3d2712', wingTip:'#6b4a2a', tail:'#f4f1ea', head:'#f4f1ea', beak:'#e0a80b', bodyLen:118, bodyH:36, headR:14, beakLen:15, wingLen:96, wingShape:'broad',   tailShape:'fan',    tailLen:34, flapRate:2.6, flapAmp:0.7, glide:0.5, glideRatio:0.55, size:1.25 },
  { id:'augur',    label:'Augur Buzzard',      archetype:'soar', body:'#3a3f4a', belly:'#c8ccd4', wing:'#262a33', wingTip:'#4a505c', tail:'#c0392b', head:'#3a3f4a', beak:'#e0a80b', bodyLen:112, bodyH:34, headR:13, beakLen:13, wingLen:90, wingShape:'broad',   tailShape:'fan',    tailLen:32, flapRate:2.8, flapAmp:0.7, glide:0.48, glideRatio:0.5, size:1.15 },
  { id:'vulture',  label:'White-backed Vulture',archetype:'soar', body:'#6b5d4a', belly:'#cfc4ae', wing:'#4a3f2f', wingTip:'#7d6f57', tail:'#4a3f2f', head:'#cfc4ae', beak:'#8a8f98', bodyLen:122, bodyH:38, headR:13, beakLen:14, wingLen:104, wingShape:'broad',  tailShape:'wedge',  tailLen:30, flapRate:2.2, flapAmp:0.62, glide:0.55, glideRatio:0.62, size:1.35 },
  { id:'albatross',label:'Wandering Albatross',archetype:'soar', body:'#eef1f4', belly:'#ffffff', wing:'#c9d2da', wingTip:'#2b3440', tail:'#c9d2da', head:'#ffffff', beak:'#e6b8a0', bodyLen:120, bodyH:32, headR:13, beakLen:16, wingLen:118, wingShape:'long',   tailShape:'wedge',  tailLen:28, flapRate:1.8, flapAmp:0.5, glide:0.6, glideRatio:0.72, size:1.3 },
  { id:'osprey',   label:'Osprey',             archetype:'soar', body:'#4a3b2a', belly:'#f4f1ea', wing:'#33291c', wingTip:'#5d4c36', tail:'#33291c', head:'#f4f1ea', beak:'#20232a', bodyLen:114, bodyH:34, headR:13, beakLen:13, wingLen:94, wingShape:'broad',   tailShape:'fan',    tailLen:32, flapRate:2.7, flapAmp:0.68, glide:0.5, glideRatio:0.52, size:1.2 },

  // ── SONG archetype: small, nimble, quick fluttery flaps ──
  { id:'weaver',   label:'Speke\'s Weaver',    archetype:'song', body:'#f6c90e', belly:'#fbe38a', wing:'#8a6d00', wingTip:'#3a3a3a', tail:'#8a6d00', head:'#f6c90e', beak:'#20232a', bodyLen:78,  bodyH:24, headR:11, beakLen:9,  wingLen:40, wingShape:'rounded', tailShape:'wedge',  tailLen:24, flapRate:9.5, flapAmp:1.0, glide:0.05, glideRatio:0.05, size:0.7 },
  { id:'roller',   label:'Lilac-breasted Roller',archetype:'song', body:'#7b5ea7', belly:'#4aa3c7', wing:'#2b6cb0', wingTip:'#63c7d6', tail:'#2b6cb0', head:'#7b5ea7', beak:'#20232a', bodyLen:88,  bodyH:26, headR:12, beakLen:10, wingLen:46, wingShape:'rounded', tailShape:'streamer', tailLen:34, flapRate:8.0, flapAmp:0.95, glide:0.1, glideRatio:0.08, size:0.8 },
  { id:'starling', label:'Superb Starling',    archetype:'song', body:'#1d4e9b', belly:'#e07b2a', wing:'#12315f', wingTip:'#2b6cb0', tail:'#12315f', head:'#12315f', beak:'#20232a', bodyLen:84,  bodyH:25, headR:11, beakLen:9,  wingLen:44, wingShape:'rounded', tailShape:'fan',    tailLen:26, flapRate:9.0, flapAmp:0.95, glide:0.08, glideRatio:0.06, size:0.75 },
  { id:'sunbird',  label:'Scarlet-chested Sunbird',archetype:'song', body:'#0f6e5c', belly:'#c0392b', wing:'#0a4a3e', wingTip:'#1d8a72', tail:'#0a4a3e', head:'#0f6e5c', beak:'#20232a', bodyLen:72,  bodyH:22, headR:10, beakLen:13, wingLen:36, wingShape:'rounded', tailShape:'wedge',  tailLen:22, flapRate:11,  flapAmp:1.05, glide:0.05, glideRatio:0.04, size:0.62 },
  { id:'sparrow',  label:'House Sparrow',      archetype:'song', body:'#8a6f4d', belly:'#d9cbb2', wing:'#6b5537', wingTip:'#a08a63', tail:'#6b5537', head:'#8a6f4d', beak:'#4a3a24', bodyLen:76,  bodyH:24, headR:11, beakLen:8,  wingLen:38, wingShape:'rounded', tailShape:'wedge',  tailLen:24, flapRate:9.5, flapAmp:1.0, glide:0.05, glideRatio:0.05, size:0.68 },

  // ── EXOTIC archetype: statement birds, slow majestic flaps, long bodies ──
  { id:'flamingo', label:'Lesser Flamingo',    archetype:'exotic', body:'#f6a5c0', belly:'#fbc7d9', wing:'#e2608f', wingTip:'#2b2b2b', tail:'#e2608f', head:'#f6a5c0', beak:'#e0a80b', legs:'#d97a9a', bodyLen:120, bodyH:30, headR:11, beakLen:14, wingLen:78, wingShape:'broad',   tailShape:'fan',    tailLen:22, longLegs:true, flapRate:3.2, flapAmp:0.7, glide:0.35, glideRatio:0.3, size:1.15 },
  { id:'crownedcrane',label:'Grey Crowned Crane',archetype:'exotic', body:'#5a5f6b', belly:'#8a8f9b', wing:'#3d414b', wingTip:'#c9a227', tail:'#3d414b', head:'#2b2e36', beak:'#20232a', legs:'#4a4a4a', crest:true, accent:'#c0392b', bodyLen:118, bodyH:34, headR:12, beakLen:12, wingLen:88, wingShape:'broad', tailShape:'fan', tailLen:26, longLegs:true, flapRate:2.8, flapAmp:0.72, glide:0.4, glideRatio:0.35, size:1.25 },
  { id:'pelican',  label:'Great White Pelican',archetype:'exotic', body:'#f4f1ea', belly:'#ffffff', wing:'#d9d2c4', wingTip:'#2b2b2b', tail:'#d9d2c4', head:'#f4f1ea', beak:'#f2994a', legs:'#e0a80b', bodyLen:130, bodyH:42, headR:14, beakLen:26, wingLen:104, wingShape:'broad',  tailShape:'fan',    tailLen:26, flapRate:2.4, flapAmp:0.66, glide:0.45, glideRatio:0.5, size:1.4 },
  { id:'heron',    label:'Grey Heron',         archetype:'exotic', body:'#9aa6b2', belly:'#e6eaf0', wing:'#6b7684', wingTip:'#2b3440', tail:'#6b7684', head:'#e6eaf0', beak:'#e0a80b', legs:'#4a4a4a', bodyLen:122, bodyH:30, headR:11, beakLen:20, wingLen:92, wingShape:'broad',  tailShape:'wedge',  tailLen:24, longLegs:true, flapRate:2.6, flapAmp:0.68, glide:0.42, glideRatio:0.4, size:1.2 },
  { id:'hornbill', label:'Von der Decken\'s Hornbill',archetype:'exotic', body:'#2b2b2b', belly:'#f4f1ea', wing:'#1a1a1a', wingTip:'#f4f1ea', tail:'#1a1a1a', head:'#2b2b2b', beak:'#e07b2a', bodyLen:104, bodyH:30, headR:13, beakLen:22, wingLen:60, wingShape:'rounded', tailShape:'long', tailLen:44, flapRate:5.5, flapAmp:0.85, glide:0.2, glideRatio:0.18, size:1.0 },
];

export const BIRD_MAP: Record<string, BirdSpec> = Object.fromEntries(BIRDS.map(b => [b.id, b]));
export const DEFAULT_BIRD = 'fisheagle';

// ── Wing geometry per shape (local units, shoulder at origin, wing up = -y) ──
// Returns the wing outline as a closed path in local coords (arm + hand).
function wingPath(b: BirdSpec): number[][] {
  const L = b.wingLen;
  switch (b.wingShape) {
    case 'broad':   // broad soaring wing with fingered tip
      return [[0,0],[L*0.28,-L*0.30],[L*0.55,-L*0.42],[L*0.82,-L*0.40],[L,-L*0.22],[L*0.86,-L*0.06],[L*0.6,L*0.04],[L*0.3,L*0.06],[0,L*0.05]];
    case 'long':    // very long narrow albatross wing
      return [[0,0],[L*0.3,-L*0.16],[L*0.7,-L*0.20],[L,-L*0.12],[L*0.9,0],[L*0.5,L*0.04],[0,L*0.03]];
    case 'rounded': // small rounded songbird wing
      return [[0,0],[L*0.3,-L*0.34],[L*0.66,-L*0.34],[L,-L*0.1],[L*0.8,L*0.08],[L*0.4,L*0.1],[0,L*0.06]];
    default:        // pointed swift/falcon wing
      return [[0,0],[L*0.34,-L*0.30],[L*0.72,-L*0.30],[L,-L*0.08],[L*0.7,L*0.02],[L*0.34,L*0.05],[0,L*0.05]];
  }
}


// ── Two-segment wing model ───────────────────────────────────────────────────
// The wing is split at the "wrist": an inner ARM and an outer HAND. Splitting
// lets the hand lag + fold against the arm during the downstroke, which is what
// makes the flap read as a wing beat instead of a rotating plank.
function armLen(b: BirdSpec): number { return b.wingLen * 0.42; }
function handLen(b: BirdSpec): number { return b.wingLen * 0.62; }
function armTip(b: BirdSpec): [number, number] { return [armLen(b) * 0.9, -armLen(b) * 0.18]; }

function armPath(b: BirdSpec): number[][] {
  const a = armLen(b);
  return [[0, 0], [a * 0.5, -a * 0.34], [a, -a * 0.2], [a * 0.9, a * 0.06], [a * 0.4, a * 0.1], [0, a * 0.06]];
}
function handPath(b: BirdSpec): number[][] {
  const h = handLen(b);
  switch (b.wingShape) {
    case 'broad':   // fingered primary tips
      return [[0, 0], [h * 0.3, -h * 0.34], [h * 0.62, -h * 0.42], [h * 0.9, -h * 0.34], [h, -h * 0.12], [h * 0.8, h * 0.02], [h * 0.4, h * 0.06], [0, h * 0.05]];
    case 'long':    // narrow albatross hand
      return [[0, 0], [h * 0.4, -h * 0.16], [h, -h * 0.1], [h * 0.9, h * 0.02], [h * 0.4, h * 0.05], [0, h * 0.04]];
    case 'rounded':
      return [[0, 0], [h * 0.36, -h * 0.3], [h * 0.8, -h * 0.2], [h, h * 0.02], [h * 0.6, h * 0.1], [0, h * 0.06]];
    default:        // pointed
      return [[0, 0], [h * 0.4, -h * 0.28], [h * 0.85, -h * 0.2], [h, -h * 0.04], [h * 0.6, h * 0.04], [0, h * 0.05]];
  }
}
function handTipPath(b: BirdSpec): number[][] {
  const h = handLen(b);
  return [[h * 0.55, -h * 0.3], [h * 0.9, -h * 0.28], [h, -h * 0.08], [h * 0.7, h * 0.0]];
}

function tailPath(b: BirdSpec, rearX: number, midY: number): number[][] {
  const L = b.tailLen;
  switch (b.tailShape) {
    case 'forked':
      return [[rearX,midY-4],[rearX-L,midY-14],[rearX-L*0.55,midY],[rearX-L,midY+14],[rearX,midY+4]];
    case 'fan':
      return [[rearX,midY-5],[rearX-L,midY-16],[rearX-L,midY+16],[rearX,midY+5]];
    case 'long':
      return [[rearX,midY-4],[rearX-L,midY-8],[rearX-L,midY+8],[rearX,midY+4]];
    case 'streamer':
      return [[rearX,midY-3],[rearX-L,midY-6],[rearX-L*0.8,midY],[rearX-L,midY+6],[rearX,midY+3]];
    default: // wedge
      return [[rearX,midY-5],[rearX-L,midY-10],[rearX-L,midY+10],[rearX,midY+5]];
  }
}

function poly(ctx: CanvasRenderingContext2D, pts: number[][], fill: string) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// ── Main renderer ────────────────────────────────────────────────────────────
// Draws the bird centred at (x,y), facing +x, rotated by `heading`, scaled so
// the body length maps to `sizePx` pixels. `tMs` drives the flap cycle.
export function drawBird(
  ctx: CanvasRenderingContext2D, spec: BirdSpec,
  x: number, y: number, heading: number, sizePx: number, tMs: number,
) {
  const s = sizePx / spec.bodyLen;             // local-unit -> px
  const t = tMs / 1000;
  // Flap angle with a glide hold: raise the wing and pause mid-cycle for soarers.
  const cyc = (t * spec.flapRate) % 1;
  const flap = Math.sin(2 * Math.PI * cyc);
  const hold = spec.glideRatio > 0 && cyc > (1 - spec.glideRatio);
  const wingAngle = -spec.glide + (hold ? spec.flapAmp * 0.4 : spec.flapAmp * flap);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.scale(s, s);

  const L = spec.bodyLen, H = spec.bodyH;
  const frontX = L * 0.5, rearX = -L * 0.5;

  // Far wing (behind body) — darker, slightly phase-shifted.
  ctx.save();
  ctx.translate(L * 0.05, -H * 0.1);
  const fArm = wingAngle * 0.85 + 0.1;
  const fHand = fArm * 1.35 - spec.flapAmp * 0.3;
  ctx.globalAlpha = 0.9;
  ctx.save(); ctx.rotate(fArm); poly(ctx, armPath(spec), spec.wingTip);
  const fat = armTip(spec); ctx.translate(fat[0], fat[1]); ctx.rotate(fHand - fArm);
  poly(ctx, handPath(spec), spec.wingTip); ctx.restore();
  ctx.restore();

  // Tail.
  poly(ctx, tailPath(spec, rearX, 0), spec.tail);

  // Trailing legs (exotic waders).
  if (spec.longLegs && spec.legs) {
    ctx.strokeStyle = spec.legs; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rearX + L * 0.1, H * 0.3);
    ctx.lineTo(rearX - spec.tailLen * 0.7, H * 0.55);
    ctx.stroke();
  }

  // Body (fuselage): ellipse with a lighter belly.
  ctx.beginPath();
  ctx.ellipse(0, 0, L * 0.5, H * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = spec.body; ctx.fill();
  ctx.beginPath();
  ctx.ellipse(L * 0.02, H * 0.16, L * 0.42, H * 0.34, 0, 0, Math.PI);
  ctx.fillStyle = spec.belly; ctx.fill();

  // Head + beak.
  const hx = frontX - spec.headR * 0.2, hy = -H * 0.28;
  ctx.beginPath(); ctx.arc(hx, hy, spec.headR, 0, Math.PI * 2); ctx.fillStyle = spec.head; ctx.fill();
  // Crowned-crane crest.
  if (spec.crest) {
    ctx.strokeStyle = spec.accent ?? spec.beak; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(hx - 2, hy - spec.headR + 2);
      ctx.lineTo(hx - 8 + i * 3, hy - spec.headR - 9); ctx.stroke();
    }
  }
  // Beak (length per species; pelican gets a long pouch).
  const bx = hx + spec.headR * 0.7;
  poly(ctx, [[bx, hy - 2], [bx + spec.beakLen, hy + 1], [bx, hy + 4]], spec.beak);
  // Eye.
  ctx.beginPath(); ctx.arc(hx + spec.headR * 0.25, hy - spec.headR * 0.15, spec.headR * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = '#10131a'; ctx.fill();

  // Near wing (in front of body) — TWO segments: the arm (inner) rotates by the
  // flap angle; the hand (outer) hinges off the arm with a lag, so the wing beats
  // like a real bird rather than rotating as one slab.
  const armAng = wingAngle;
  const handAng = wingAngle * 1.35 - spec.flapAmp * 0.35; // hand lags + folds
  ctx.save();
  ctx.translate(L * 0.08, -H * 0.05);
  // arm
  ctx.save();
  ctx.rotate(armAng);
  poly(ctx, armPath(spec), spec.wing);
  // hand, hinged at the arm tip
  const at = armTip(spec);
  ctx.translate(at[0], at[1]);
  ctx.rotate(handAng - armAng);
  poly(ctx, handPath(spec), spec.wing);
  ctx.globalAlpha = 0.55; poly(ctx, handTipPath(spec), spec.wingTip); ctx.globalAlpha = 1;
  ctx.restore();
  ctx.restore();

  ctx.restore();
}

// ── Perch (resting) pose: wings folded, sitting at the origin ───────────────
export function drawBirdPerched(
  ctx: CanvasRenderingContext2D, spec: BirdSpec,
  x: number, y: number, sizePx: number, tMs: number,
) {
  // Folded wing = wing held down/back; a gentle idle bob.
  const bob = Math.sin(tMs * 0.002) * sizePx * 0.01;
  ctx.save();
  ctx.translate(x, y + bob);
  const s = sizePx / spec.bodyLen;
  ctx.scale(s, s);
  const L = spec.bodyLen, H = spec.bodyH;
  const frontX = L * 0.5, rearX = -L * 0.5;
  // folded wing along the back
  poly(ctx, [[L*0.1,-H*0.2],[rearX+L*0.2,-H*0.05],[rearX+L*0.05,H*0.15],[L*0.15,H*0.05]], spec.wing);
  poly(ctx, tailPath(spec, rearX, H*0.1), spec.tail);
  ctx.beginPath(); ctx.ellipse(0, 0, L*0.5, H*0.5, 0, 0, Math.PI*2); ctx.fillStyle = spec.body; ctx.fill();
  ctx.beginPath(); ctx.ellipse(L*0.02, H*0.16, L*0.42, H*0.34, 0, 0, Math.PI); ctx.fillStyle = spec.belly; ctx.fill();
  const hx = frontX - spec.headR*0.2, hy = -H*0.28;
  ctx.beginPath(); ctx.arc(hx, hy, spec.headR, 0, Math.PI*2); ctx.fillStyle = spec.head; ctx.fill();
  if (spec.crest) {
    ctx.strokeStyle = spec.accent ?? spec.beak; ctx.lineWidth = 2.4; ctx.lineCap='round';
    for (let i=-2;i<=2;i++){ ctx.beginPath(); ctx.moveTo(hx-2,hy-spec.headR+2); ctx.lineTo(hx-8+i*3,hy-spec.headR-9); ctx.stroke(); }
  }
  const bx = hx + spec.headR*0.7;
  poly(ctx, [[bx,hy-2],[bx+spec.beakLen,hy+1],[bx,hy+4]], spec.beak);
  ctx.beginPath(); ctx.arc(hx+spec.headR*0.25, hy-spec.headR*0.15, spec.headR*0.16, 0, Math.PI*2); ctx.fillStyle='#10131a'; ctx.fill();
  ctx.restore();
}
