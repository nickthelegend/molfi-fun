/**
 * The XORR console, as geometry.
 *
 * One definition, two consumers: tools/model/build-model.mjs serialises it to a .glb
 * for anyone who wants the asset, and the web app builds BufferGeometry from it
 * directly. Shipping the shape as data rather than a binary the browser has to fetch
 * and parse means the hero cannot be defeated by a loader, a decoder CDN, or a
 * suspended fetch — it is just arrays.
 */

export interface MaterialDef {
  name: string;
  /** hex, e.g. "#f7efc2" */
  color: string;
  metallic: number;
  roughness: number;
  /** linear RGB, only where the surface should read as lit */
  emissive?: [number, number, number];
}

export const CONSOLE_MATERIALS: MaterialDef[] = [
  { name: "shell", color: "#f7efc2", metallic: 0.03, roughness: 0.52 },
  { name: "shellDark", color: "#e0d5a2", metallic: 0.03, roughness: 0.6 },
  { name: "screen", color: "#050505", metallic: 0.15, roughness: 0.16 },
  { name: "amber", color: "#ff9f0a", metallic: 0, roughness: 0.4, emissive: [0.7, 0.42, 0.03] },
  { name: "orange", color: "#f26522", metallic: 0.05, roughness: 0.45 },
  { name: "lilac", color: "#9b8cf0", metallic: 0.05, roughness: 0.42 },
  { name: "gold", color: "#f5c518", metallic: 0.75, roughness: 0.28 },
  { name: "ink", color: "#141414", metallic: 0.1, roughness: 0.55 },
  { name: "blue", color: "#4a90e2", metallic: 0.05, roughness: 0.45 },
  { name: "green", color: "#35c77e", metallic: 0.05, roughness: 0.45 },
  { name: "yellow", color: "#f5d547", metallic: 0.05, roughness: 0.45 },
  { name: "pink", color: "#e8b4d8", metallic: 0.05, roughness: 0.45 },
  { name: "red", color: "#e8453c", metallic: 0.05, roughness: 0.45 },
  { name: "paper", color: "#f5f5f0", metallic: 0.02, roughness: 0.7 },
];

const M: Record<string, number> = Object.fromEntries(
  CONSOLE_MATERIALS.map((m, i) => [m.name, i]),
);

export type Vec3 = [number, number, number];

export interface Transform {
  t?: Vec3;
  s?: Vec3;
  rx?: number;
  ry?: number;
  rz?: number;
}

export class Mesh {
  positions: number[] = [];
  normals: number[] = [];
  indices: number[] = [];
  /** @dev Explicit fields, not constructor parameter properties: Node runs this
   *       package's TypeScript source directly and its strip-only mode rejects them. */
  readonly name: string;
  readonly material: number;

  constructor(name: string, material: number) {
    this.name = name;
    this.material = material;
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
    const n = faceNormal(a, b, c);
    const base = this.vertexCount;
    for (const v of [a, b, c, d]) {
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(n[0], n[1], n[2]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  tri(a: Vec3, b: Vec3, c: Vec3) {
    const n = faceNormal(a, b, c);
    const base = this.vertexCount;
    for (const v of [a, b, c]) {
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(n[0], n[1], n[2]);
    }
    this.indices.push(base, base + 1, base + 2);
    return this;
  }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const n = cross(sub(b, a), sub(c, a));
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/** Scale, then rotate about Z/X/Y, then translate. */
export function xform(p: Vec3, tf: Transform = {}): Vec3 {
  const { t = [0, 0, 0], s = [1, 1, 1], rx = 0, ry = 0, rz = 0 } = tf;
  let [x, y, z] = [p[0] * s[0], p[1] * s[1], p[2] * s[2]];
  if (rz) {
    const c = Math.cos(rz);
    const si = Math.sin(rz);
    [x, y] = [x * c - y * si, x * si + y * c];
  }
  if (rx) {
    const c = Math.cos(rx);
    const si = Math.sin(rx);
    [y, z] = [y * c - z * si, y * si + z * c];
  }
  if (ry) {
    const c = Math.cos(ry);
    const si = Math.sin(ry);
    [x, z] = [x * c + z * si, -x * si + z * c];
  }
  return [x + t[0], y + t[1], z + t[2]];
}

export function box(mesh: Mesh, w: number, h: number, d: number, tf: Transform = {}) {
  const [X, Y, Z] = [w / 2, h / 2, d / 2];
  const v = (
    [
      [-X, -Y, Z],
      [X, -Y, Z],
      [X, Y, Z],
      [-X, Y, Z],
      [-X, -Y, -Z],
      [X, -Y, -Z],
      [X, Y, -Z],
      [-X, Y, -Z],
    ] as Vec3[]
  ).map((p) => xform(p, tf));

  mesh.quad(v[0], v[1], v[2], v[3]);
  mesh.quad(v[5], v[4], v[7], v[6]);
  mesh.quad(v[1], v[5], v[6], v[2]);
  mesh.quad(v[4], v[0], v[3], v[7]);
  mesh.quad(v[3], v[2], v[6], v[7]);
  mesh.quad(v[4], v[5], v[1], v[0]);
  return mesh;
}

/** Box with its top face inset — reads as machined plastic rather than a primitive. */
export function chamferBox(
  mesh: Mesh,
  w: number,
  h: number,
  d: number,
  bevel: number,
  tf: Transform = {},
) {
  const [X, Y, Z] = [w / 2, h / 2, d / 2];
  const bx = X - bevel;
  const bz = Z - bevel;

  const bot = (
    [
      [-X, -Y, Z],
      [X, -Y, Z],
      [X, -Y, -Z],
      [-X, -Y, -Z],
    ] as Vec3[]
  ).map((p) => xform(p, tf));
  const rim = (
    [
      [-X, Y - bevel, Z],
      [X, Y - bevel, Z],
      [X, Y - bevel, -Z],
      [-X, Y - bevel, -Z],
    ] as Vec3[]
  ).map((p) => xform(p, tf));
  const top = (
    [
      [-bx, Y, bz],
      [bx, Y, bz],
      [bx, Y, -bz],
      [-bx, Y, -bz],
    ] as Vec3[]
  ).map((p) => xform(p, tf));

  mesh.quad(bot[3], bot[2], bot[1], bot[0]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    mesh.quad(bot[i], bot[j], rim[j], rim[i]);
    mesh.quad(rim[i], rim[j], top[j], top[i]);
  }
  mesh.quad(top[0], top[1], top[2], top[3]);
  return mesh;
}

export function cylinder(
  mesh: Mesh,
  radius: number,
  height: number,
  segments = 24,
  tf: Transform = {},
) {
  const Y = height / 2;
  const ring = (y: number) =>
    Array.from({ length: segments }, (_, i) => {
      const a = (i / segments) * Math.PI * 2;
      return xform([Math.cos(a) * radius, y, Math.sin(a) * radius], tf);
    });
  const top = ring(Y);
  const bot = ring(-Y);
  const cTop = xform([0, Y, 0], tf);
  const cBot = xform([0, -Y, 0], tf);

  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    mesh.quad(bot[i], bot[j], top[j], top[i]);
    mesh.tri(cTop, top[i], top[j]);
    mesh.tri(cBot, bot[j], bot[i]);
  }
  return mesh;
}

/**
 * Build the console: a portrait handheld with a cream body, a segmented colour strip
 * running around the screen bezel, a black display, two lilac keys, one orange key,
 * and a stack of gold coins on the deck.
 */
export function buildConsole(): Mesh[] {
  const mk = (name: string, mat: string) => new Mesh(name, M[mat]);

  const shell = mk("shell", "shell");
  const shellDark = mk("shell-edge", "shellDark");
  const screen = mk("screen", "screen");
  const amber = mk("readout", "amber");
  const orange = mk("key-orange", "orange");
  const lilac = mk("keys-lilac", "lilac");
  const gold = mk("coins", "gold");
  const ink = mk("ink", "ink");
  const tape: Record<string, Mesh> = {
    blue: mk("tape-blue", "blue"),
    green: mk("tape-green", "green"),
    yellow: mk("tape-yellow", "yellow"),
    pink: mk("tape-pink", "pink"),
    red: mk("tape-red", "red"),
    paper: mk("tape-paper", "paper"),
    orange: mk("tape-orange", "orange"),
    ink: mk("tape-ink", "ink"),
  };

  /** Face the chamfered side toward the viewer (+Z) instead of up (+Y). */
  const FLAT = Math.PI / 2;
  const slab = (
    m: Mesh,
    w: number,
    h: number,
    t: number,
    bevel: number,
    x: number,
    y: number,
    z: number,
  ) => chamferBox(m, w, t, h, bevel, { t: [x, y, z], rx: FLAT });

  const W = 1.02;
  const H = 1.86;
  const T = 0.17;

  // ---- body
  slab(shell, W, H, T, 0.03, 0, 0, 0);
  box(shellDark, W - 0.03, H - 0.03, 0.02, { t: [0, 0, -T / 2 - 0.008] });

  // ---- screen
  const SCREEN_W = 0.8;
  const SCREEN_H = 1.06;
  const SCREEN_Y = 0.3;
  const FACE = T / 2;

  box(ink, SCREEN_W + 0.06, SCREEN_H + 0.06, 0.02, { t: [0, SCREEN_Y, FACE - 0.004] });
  box(screen, SCREEN_W, SCREEN_H, 0.02, { t: [0, SCREEN_Y, FACE + 0.004] });

  // Segmented colour strip around the bezel. Uneven runs, the way tape laid by hand
  // looks — an evenly divided rainbow reads as a progress bar.
  const STRIP: [string, number][] = [
    ["blue", 0.2], ["paper", 0.09], ["orange", 0.16], ["green", 0.11],
    ["yellow", 0.14], ["pink", 0.1], ["ink", 0.07], ["blue", 0.17],
    ["paper", 0.12], ["red", 0.15], ["yellow", 0.09], ["green", 0.13],
    ["pink", 0.08], ["orange", 0.12], ["blue", 0.14], ["paper", 0.1],
    ["red", 0.11], ["ink", 0.08], ["green", 0.16], ["yellow", 0.12],
  ];

  const BEZEL = 0.055;
  const halfW = SCREEN_W / 2 + BEZEL / 2 + 0.012;
  const halfH = SCREEN_H / 2 + BEZEL / 2 + 0.012;
  const topRun = SCREEN_W + 2 * BEZEL;
  const sideRun = SCREEN_H + 2 * BEZEL;
  const perim = 2 * (SCREEN_W + SCREEN_H) + 8 * BEZEL;

  let travelled = 0;
  let seg = 0;
  while (travelled < perim - 0.01) {
    const [colour, wantLen] = STRIP[seg % STRIP.length];
    seg++;
    const len = Math.min(wantLen, perim - travelled);
    const mid = travelled + len / 2;
    const m = tape[colour];

    if (mid < topRun) {
      box(m, len, BEZEL, 0.018, { t: [-topRun / 2 + mid, SCREEN_Y + halfH, FACE + 0.002] });
    } else if (mid < topRun + sideRun) {
      const y = SCREEN_Y + sideRun / 2 - (mid - topRun);
      box(m, BEZEL, len, 0.018, { t: [halfW, y, FACE + 0.002] });
    } else if (mid < 2 * topRun + sideRun) {
      const x = topRun / 2 - (mid - topRun - sideRun);
      box(m, len, BEZEL, 0.018, { t: [x, SCREEN_Y - halfH, FACE + 0.002] });
    } else {
      const y = SCREEN_Y - sideRun / 2 + (mid - 2 * topRun - sideRun);
      box(m, BEZEL, len, 0.018, { t: [-halfW, y, FACE + 0.002] });
    }
    travelled += len;
  }

  // ---- screen content: "PRESS START" as blocks, and a trace above it
  const GLYPHS = [3, 2, 3, 2, 2, 1, 2, 3, 2, 3];
  let gx = -0.3;
  for (const wBlocks of GLYPHS) {
    for (let i = 0; i < wBlocks; i++) {
      box(amber, 0.022, 0.05, 0.012, { t: [gx, SCREEN_Y - 0.02, FACE + 0.014] });
      gx += 0.028;
    }
    gx += 0.022;
  }

  const trace = [0.02, 0.05, 0.03, 0.08, 0.06, 0.1, 0.08, 0.12];
  trace.forEach((v, i) => {
    box(amber, 0.06, 0.012, 0.01, { t: [-0.28 + i * 0.075, SCREEN_Y + 0.24 + v, FACE + 0.014] });
  });

  // ---- deck
  slab(orange, 0.215, 0.215, 0.075, 0.02, 0.265, -0.44, FACE + 0.02);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      box(ink, 0.05, 0.05, 0.004, {
        t: [0.265 - 0.06 + i * 0.06, -0.44 - 0.06 + j * 0.06, FACE + 0.06],
      });
    }
  }

  slab(lilac, 0.215, 0.19, 0.07, 0.02, -0.29, -0.63, FACE + 0.02);
  slab(lilac, 0.215, 0.19, 0.07, 0.02, -0.05, -0.63, FACE + 0.02);

  box(ink, 0.15, 0.045, 0.012, { t: [-0.29, -0.775, FACE + 0.004] });
  box(ink, 0.15, 0.045, 0.012, { t: [-0.05, -0.775, FACE + 0.004] });

  slab(ink, 0.155, 0.085, 0.03, 0.012, 0.135, -0.775, FACE + 0.012);

  for (let i = 0; i < 7; i++) {
    box(gold, 0.175, 0.032, 0.055, { t: [0.3, -0.8 + i * 0.038, FACE + 0.028] });
  }

  for (const y of [-0.3, -0.52]) {
    box(ink, 0.016, 0.06, 0.008, { t: [-0.435, y, FACE + 0.002] });
    box(ink, 0.042, 0.016, 0.008, { t: [-0.435, y + 0.03, FACE + 0.002] });
  }

  for (const sx of [-1, 1]) {
    cylinder(shellDark, 0.02, 0.16, 12, {
      t: [sx * (W / 2 - 0.004), 0.62, 0],
      rz: Math.PI / 2,
    });
  }

  const all = [shell, shellDark, screen, amber, orange, lilac, gold, ink, ...Object.values(tape)];
  return all.filter((m) => m.indices.length > 0);
}
