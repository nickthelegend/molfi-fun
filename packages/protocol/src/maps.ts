/**
 * Ships, as data.
 *
 * Until now the map existed twice: a room graph in the keeper that decided what moves were
 * legal, and 2,670 lines of hardcoded art in the client that decided what you saw. Two
 * sources of truth for one ship is how you end up with a vent you can see but not use.
 *
 * A `ShipMap` is the single description of a vessel — geometry, connections, vents, cameras,
 * task rooms and fixtures. The keeper derives its rules from it and the client draws it, so
 * adding a ship is authoring one object, and the ship you look at is the ship you play.
 */

export type FixtureKind =
  | "console" // a screen you stand at: Admin, Navigation, Weapons
  | "table" // long surfaces: Cafeteria
  | "crate" // storage
  | "reactor" // the glowing core
  | "engine" // thruster housings
  | "medpod" // MedBay scanners
  | "wiring" // Electrical panels
  | "oxygen" // O2 canisters
  | "camera" // a wall camera, drawn where a watcher can be seen
  | "vent" // a floor vent
  | "pipe" // decorative conduit
  | "locker"
  | "server"
  | "window";

export interface Fixture {
  kind: FixtureKind;
  /** Position relative to the room's top-left, in map units. */
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Degrees, for fixtures that read directionally. */
  rotate?: number;
}

export interface RoomSpec {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Wall colour and floor colour. Rooms should be tellable apart at a glance. */
  wall: string;
  floor: string;
  /** Floor treatment, which does a lot of the work of making a room feel like itself. */
  pattern: "tile" | "grate" | "plate" | "hazard" | "smooth";
  fixtures: Fixture[];
  /** Tasks can be done here. Rooms without tasks are pure transit — and pure danger. */
  hasTasks: boolean;
}

export interface ShipMap {
  id: string;
  name: string;
  /** One line of flavour, shown when a match starts. */
  tagline: string;
  width: number;
  height: number;
  rooms: RoomSpec[];
  /** Undirected corridors. Movement is legal along these and nowhere else. */
  corridors: Array<[number, number]>;
  /** Vents, impostor-only. Deliberately not the same shape as the corridors. */
  vents: Array<[number, number]>;
  /** Rooms a camera watcher can see. */
  cameraRooms: number[];
  /** Where the cameras are watched from. */
  securityRoom: number;
  /** Where everyone starts. */
  spawnRoom: number;
  /** Backdrop tint, so the three ships do not feel like one ship repainted. */
  space: { near: string; far: string };
}

// ══════════════════════════════════════════════════════════════════════════════════════
// 1. Obsidian Prime — the original hull. Long corridors, two wings, a classic.
// ══════════════════════════════════════════════════════════════════════════════════════

const OBSIDIAN: ShipMap = {
  id: "obsidian",
  name: "Obsidian Prime",
  tagline: "A mining hauler with too many corridors and not enough witnesses.",
  width: 5850,
  height: 3330,
  space: { near: "#141b2c", far: "#05060a" },
  spawnRoom: 0,
  securityRoom: 7,
  cameraRooms: [0, 2, 4, 8],
  rooms: [
    {
      id: 0, name: "Cafeteria", x: 2470, y: 140, width: 900, height: 620,
      wall: "#4a5568", floor: "#5a6578", pattern: "tile", hasTasks: false,
      fixtures: [
        { kind: "table", x: 250, y: 200, w: 400, h: 180 },
        { kind: "console", x: 60, y: 80, w: 120, h: 90 },
        { kind: "window", x: 700, y: 60, w: 150, h: 70 },
        { kind: "vent", x: 780, y: 500 },
      ],
    },
    {
      id: 1, name: "Admin", x: 2640, y: 1460, width: 560, height: 460,
      wall: "#5a4a6a", floor: "#6a5a7a", pattern: "plate", hasTasks: true,
      fixtures: [
        { kind: "console", x: 180, y: 120, w: 220, h: 120 },
        { kind: "server", x: 40, y: 260, w: 90, h: 140 },
        { kind: "vent", x: 460, y: 360 },
      ],
    },
    {
      id: 2, name: "Storage", x: 1230, y: 1380, width: 900, height: 620,
      wall: "#6a5a3a", floor: "#7a6a4a", pattern: "grate", hasTasks: true,
      fixtures: [
        { kind: "crate", x: 100, y: 120, w: 110, h: 110 },
        { kind: "crate", x: 240, y: 120, w: 110, h: 110 },
        { kind: "crate", x: 100, y: 260, w: 110, h: 110 },
        { kind: "locker", x: 700, y: 380, w: 120, h: 160 },
      ],
    },
    {
      id: 3, name: "Electrical", x: 1370, y: 2670, width: 620, height: 520,
      wall: "#6a6a3a", floor: "#5a5a2e", pattern: "hazard", hasTasks: true,
      fixtures: [
        { kind: "wiring", x: 80, y: 100, w: 160, h: 200 },
        { kind: "wiring", x: 320, y: 100, w: 160, h: 200 },
        { kind: "pipe", x: 60, y: 380, w: 480, h: 40 },
        { kind: "vent", x: 520, y: 420 },
      ],
    },
    {
      id: 4, name: "MedBay", x: 1370, y: 190, width: 620, height: 520,
      wall: "#3a5a4a", floor: "#4a6a5a", pattern: "smooth", hasTasks: true,
      fixtures: [
        { kind: "medpod", x: 90, y: 140, w: 130, h: 220 },
        { kind: "medpod", x: 260, y: 140, w: 130, h: 220 },
        { kind: "console", x: 440, y: 120, w: 120, h: 100 },
        { kind: "vent", x: 520, y: 400 },
      ],
    },
    {
      id: 5, name: "Upper Engine", x: 140, y: 190, width: 600, height: 520,
      wall: "#5a3a3a", floor: "#6a4a4a", pattern: "grate", hasTasks: true,
      fixtures: [
        { kind: "engine", x: 120, y: 110, w: 340, h: 280 },
        { kind: "pipe", x: 60, y: 430, w: 460, h: 36 },
      ],
    },
    {
      id: 6, name: "Lower Engine", x: 140, y: 1430, width: 600, height: 520,
      wall: "#5a3a3a", floor: "#6a4a4a", pattern: "grate", hasTasks: true,
      fixtures: [
        { kind: "engine", x: 120, y: 110, w: 340, h: 280 },
        { kind: "vent", x: 500, y: 430 },
      ],
    },
    {
      id: 7, name: "Security", x: 160, y: 2700, width: 560, height: 460,
      wall: "#3a4a6a", floor: "#44557a", pattern: "plate", hasTasks: false,
      fixtures: [
        { kind: "camera", x: 150, y: 90, w: 260, h: 150 },
        { kind: "console", x: 180, y: 280, w: 200, h: 100 },
        { kind: "vent", x: 470, y: 370 },
      ],
    },
    {
      id: 8, name: "Reactor", x: 2640, y: 2700, width: 560, height: 460,
      wall: "#6a3a3a", floor: "#7a4a4a", pattern: "hazard", hasTasks: true,
      fixtures: [
        { kind: "reactor", x: 160, y: 110, w: 240, h: 240 },
        { kind: "pipe", x: 40, y: 380, w: 480, h: 40 },
      ],
    },
    {
      id: 9, name: "Weapons", x: 3850, y: 190, width: 620, height: 520,
      wall: "#4a4a6a", floor: "#5a5a7a", pattern: "plate", hasTasks: true,
      fixtures: [
        { kind: "console", x: 160, y: 130, w: 300, h: 160 },
        { kind: "window", x: 120, y: 350, w: 380, h: 110 },
      ],
    },
    {
      id: 10, name: "Navigation", x: 5090, y: 810, width: 620, height: 520,
      wall: "#3a5a6a", floor: "#4a6a7a", pattern: "smooth", hasTasks: true,
      fixtures: [
        { kind: "console", x: 150, y: 120, w: 320, h: 180 },
        { kind: "window", x: 110, y: 340, w: 400, h: 120 },
      ],
    },
    {
      id: 11, name: "Shields", x: 3850, y: 1430, width: 620, height: 520,
      wall: "#5a5a3a", floor: "#6a6a4a", pattern: "plate", hasTasks: true,
      fixtures: [
        { kind: "console", x: 180, y: 140, w: 260, h: 140 },
        { kind: "pipe", x: 80, y: 360, w: 460, h: 36 },
      ],
    },
    {
      id: 12, name: "O2", x: 5140, y: 1470, width: 520, height: 440,
      wall: "#3a6a5a", floor: "#4a7a6a", pattern: "smooth", hasTasks: true,
      fixtures: [
        { kind: "oxygen", x: 90, y: 110, w: 100, h: 220 },
        { kind: "oxygen", x: 230, y: 110, w: 100, h: 220 },
      ],
    },
    {
      id: 13, name: "Communications", x: 3850, y: 2700, width: 620, height: 460,
      wall: "#4a3a5a", floor: "#5a4a6a", pattern: "plate", hasTasks: true,
      fixtures: [
        { kind: "server", x: 90, y: 110, w: 110, h: 240 },
        { kind: "server", x: 240, y: 110, w: 110, h: 240 },
        { kind: "console", x: 400, y: 150, w: 150, h: 110 },
      ],
    },
  ],
  corridors: [
    [5, 4], [4, 0], [0, 9], [5, 8], [8, 7], [7, 6], [0, 1], [1, 2],
    [6, 3], [3, 2], [9, 10], [10, 12], [10, 11], [11, 2], [2, 13],
  ],
  vents: [[0, 1], [4, 3], [3, 7], [7, 6], [6, 5]],
};

// ══════════════════════════════════════════════════════════════════════════════════════
// 2. Kuiper Relay — a ring. Everything circulates, so nowhere is a dead end and an alibi
//    is much harder to prove: there is always another way round.
// ══════════════════════════════════════════════════════════════════════════════════════

const KUIPER: ShipMap = {
  id: "kuiper",
  name: "Kuiper Relay",
  tagline: "A relay station built as a ring. There is always another way round.",
  width: 5260,
  height: 3300,
  space: { near: "#101a24", far: "#03060a" },
  spawnRoom: 0,
  securityRoom: 6,
  cameraRooms: [1, 3, 5, 7],
  rooms: [
    {
      id: 0, name: "Hub", x: 1870, y: 1300, width: 900, height: 700,
      wall: "#40506a", floor: "#4e5f7c", pattern: "tile", hasTasks: false,
      fixtures: [
        { kind: "table", x: 300, y: 260, w: 300, h: 180 },
        { kind: "window", x: 120, y: 80, w: 200, h: 80 },
        { kind: "window", x: 580, y: 80, w: 200, h: 80 },
        { kind: "vent", x: 800, y: 580 },
      ],
    },
    {
      id: 1, name: "North Dock", x: 1970, y: 150, width: 700, height: 520,
      wall: "#3a5a6a", floor: "#48697a", pattern: "plate", hasTasks: true,
      fixtures: [
        { kind: "wiring", x: 540, y: 140, w: 110, h: 170 },
        { kind: "console", x: 200, y: 130, w: 300, h: 150 },
        { kind: "window", x: 150, y: 330, w: 400, h: 120 },
      ],
    },
    {
      id: 2, name: "Cryo Bay", x: 3240, y: 770, width: 640, height: 520,
      wall: "#3a6a64", floor: "#478079", pattern: "smooth", hasTasks: true,
      fixtures: [
        { kind: "medpod", x: 90, y: 120, w: 120, h: 240 },
        { kind: "medpod", x: 250, y: 120, w: 120, h: 240 },
        { kind: "medpod", x: 410, y: 120, w: 120, h: 240 },
      ],
    },
    {
      id: 3, name: "East Array", x: 4480, y: 1370, width: 640, height: 560,
      wall: "#4a4a72", floor: "#5a5a86", pattern: "plate", hasTasks: true,
      fixtures: [
        { kind: "server", x: 90, y: 110, w: 110, h: 260 },
        { kind: "server", x: 240, y: 110, w: 110, h: 260 },
        { kind: "console", x: 400, y: 160, w: 170, h: 120 },
      ],
    },
    {
      id: 4, name: "Fuel Cells", x: 3240, y: 2620, width: 640, height: 540,
      wall: "#6a5230", floor: "#7d6340", pattern: "hazard", hasTasks: true,
      fixtures: [
        { kind: "oxygen", x: 80, y: 110, w: 110, h: 250 },
        { kind: "oxygen", x: 230, y: 110, w: 110, h: 250 },
        { kind: "pipe", x: 60, y: 400, w: 500, h: 40 },
        { kind: "vent", x: 560, y: 450 },
      ],
    },
    {
      id: 5, name: "South Dock", x: 1970, y: 2640, width: 700, height: 500,
      wall: "#3a5a6a", floor: "#48697a", pattern: "plate", hasTasks: true,
      fixtures: [
        { kind: "console", x: 200, y: 120, w: 300, h: 150 },
        { kind: "crate", x: 80, y: 320, w: 110, h: 110 },
        { kind: "crate", x: 220, y: 320, w: 110, h: 110 },
      ],
    },
    {
      id: 6, name: "Watch Post", x: 150, y: 2620, width: 620, height: 540,
      wall: "#3a4a6a", floor: "#455680", pattern: "plate", hasTasks: false,
      fixtures: [
        { kind: "camera", x: 160, y: 100, w: 300, h: 170 },
        { kind: "console", x: 200, y: 320, w: 220, h: 110 },
        { kind: "vent", x: 530, y: 440 },
      ],
    },
    {
      id: 7, name: "West Array", x: 140, y: 1370, width: 640, height: 560,
      wall: "#4a4a72", floor: "#5a5a86", pattern: "plate", hasTasks: true,
      fixtures: [
        { kind: "server", x: 100, y: 110, w: 110, h: 260 },
        { kind: "console", x: 280, y: 160, w: 240, h: 140 },
      ],
    },
    {
      id: 8, name: "Reactor Ring", x: 140, y: 140, width: 640, height: 540,
      wall: "#6a3438", floor: "#7d4247", pattern: "hazard", hasTasks: true,
      fixtures: [
        { kind: "reactor", x: 190, y: 130, w: 260, h: 260 },
        { kind: "pipe", x: 60, y: 430, w: 520, h: 40 },
        { kind: "vent", x: 560, y: 470 },
      ],
    },
  ],
  // A true ring, plus four spokes into the hub. No dead ends anywhere.
  corridors: [
    [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 1],
    [0, 1], [0, 3], [0, 5], [0, 7],
  ],
  // The vents cut across the ring, which is the impostor's whole edge here.
  vents: [[0, 2], [0, 6], [4, 8], [3, 7]],
};

// ══════════════════════════════════════════════════════════════════════════════════════
// 3. Deep Core — a mining shaft. Three decks, two lifts, almost no lateral movement.
//    Chokepoints everywhere: being seen on the wrong deck is close to a confession.
// ══════════════════════════════════════════════════════════════════════════════════════

const DEEPCORE: ShipMap = {
  id: "deepcore",
  name: "Deep Core",
  tagline: "Three decks, two lifts. Nowhere to be that nobody can account for.",
  width: 4650,
  height: 3940,
  space: { near: "#1a1410", far: "#070403" },
  spawnRoom: 0,
  securityRoom: 4,
  cameraRooms: [0, 3, 6, 8],
  rooms: [
    {
      id: 0, name: "Surface Dock", x: 1810, y: 140, width: 900, height: 560,
      wall: "#4a4a52", floor: "#5b5b64", pattern: "tile", hasTasks: false,
      fixtures: [
        { kind: "table", x: 280, y: 220, w: 340, h: 160 },
        { kind: "window", x: 120, y: 70, w: 220, h: 90 },
        { kind: "crate", x: 720, y: 380, w: 110, h: 110 },
      ],
    },
    {
      id: 1, name: "Upper Lift", x: 170, y: 830, width: 460, height: 420,
      wall: "#3f4a5a", floor: "#4d5b6e", pattern: "plate", hasTasks: false,
      fixtures: [
        { kind: "wiring", x: 90, y: 280, w: 140, h: 90 },
        { kind: "console", x: 130, y: 120, w: 200, h: 120 },
        { kind: "vent", x: 380, y: 330 },
      ],
    },
    {
      id: 2, name: "Assay Lab", x: 1910, y: 1400, width: 700, height: 520,
      wall: "#3a6058", floor: "#48756c", pattern: "smooth", hasTasks: true,
      fixtures: [
        { kind: "medpod", x: 100, y: 130, w: 130, h: 230 },
        { kind: "console", x: 300, y: 140, w: 280, h: 150 },
      ],
    },
    {
      id: 3, name: "Ore Sorting", x: 3730, y: 760, width: 780, height: 560,
      wall: "#6a5a34", floor: "#7d6c42", pattern: "grate", hasTasks: true,
      fixtures: [
        { kind: "crate", x: 90, y: 110, w: 120, h: 120 },
        { kind: "crate", x: 240, y: 110, w: 120, h: 120 },
        { kind: "crate", x: 90, y: 260, w: 120, h: 120 },
        { kind: "locker", x: 560, y: 300, w: 130, h: 180 },
        { kind: "vent", x: 690, y: 120 },
      ],
    },
    {
      id: 4, name: "Shaft Watch", x: 140, y: 1430, width: 520, height: 460,
      wall: "#3a4a6a", floor: "#455680", pattern: "plate", hasTasks: false,
      fixtures: [
        { kind: "server", x: 400, y: 280, w: 90, h: 140 },
        { kind: "camera", x: 130, y: 90, w: 260, h: 160 },
        { kind: "console", x: 170, y: 290, w: 200, h: 100 },
      ],
    },
    {
      id: 5, name: "Drill Head", x: 1230, y: 1970, width: 820, height: 620,
      wall: "#6a3a30", floor: "#7d493d", pattern: "hazard", hasTasks: true,
      fixtures: [
        { kind: "engine", x: 200, y: 150, w: 420, h: 320 },
        { kind: "pipe", x: 80, y: 520, w: 660, h: 44 },
        { kind: "vent", x: 740, y: 540 },
      ],
    },
    {
      id: 6, name: "Coolant", x: 3780, y: 2000, width: 680, height: 560,
      wall: "#3a5a6a", floor: "#48697d", pattern: "plate", hasTasks: true,
      fixtures: [
        { kind: "oxygen", x: 100, y: 120, w: 110, h: 250 },
        { kind: "oxygen", x: 250, y: 120, w: 110, h: 250 },
        { kind: "pipe", x: 70, y: 420, w: 540, h: 40 },
      ],
    },
    {
      id: 7, name: "Lower Lift", x: 170, y: 2070, width: 460, height: 420,
      wall: "#3f4a5a", floor: "#4d5b6e", pattern: "plate", hasTasks: false,
      fixtures: [
        { kind: "console", x: 130, y: 120, w: 200, h: 120 },
        { kind: "vent", x: 380, y: 330 },
      ],
    },
    {
      id: 8, name: "Core Reactor", x: 1850, y: 2590, width: 820, height: 620,
      wall: "#6a3438", floor: "#7d4247", pattern: "hazard", hasTasks: true,
      fixtures: [
        { kind: "reactor", x: 260, y: 160, w: 300, h: 300 },
        { kind: "pipe", x: 80, y: 520, w: 660, h: 44 },
      ],
    },
    {
      id: 9, name: "Deep Store", x: 3780, y: 3240, width: 680, height: 560,
      wall: "#5a4a3a", floor: "#6d5b48", pattern: "grate", hasTasks: true,
      fixtures: [
        { kind: "crate", x: 90, y: 120, w: 120, h: 120 },
        { kind: "crate", x: 240, y: 120, w: 120, h: 120 },
        { kind: "locker", x: 460, y: 280, w: 140, h: 200 },
        { kind: "vent", x: 610, y: 130 },
      ],
    },
  ],
  // Vertical by design: decks connect through the lifts, barely to each other.
  corridors: [
    [0, 2], [0, 3], [2, 1], [2, 3], [1, 4], [4, 5], [5, 6], [3, 6],
    [5, 7], [7, 8], [8, 9], [6, 9],
  ],
  // Vents run the shaft, so an impostor can cross decks that nobody else can.
  vents: [[1, 7], [3, 9], [5, 8]],
};

export const SHIP_MAPS: ShipMap[] = [OBSIDIAN, KUIPER, DEEPCORE];

export function shipMapById(id: string): ShipMap {
  return SHIP_MAPS.find((map) => map.id === id) ?? OBSIDIAN;
}

/**
 * Picks the ship for a match from `final_seed`.
 *
 * Same reasoning as roles and personas: which map you play is not the operator's choice, and
 * nobody knows it before the roster locks.
 */
export function shipMapForSeed(finalSeed: bigint): ShipMap {
  return SHIP_MAPS[Number(finalSeed % BigInt(SHIP_MAPS.length))];
}

/** Adjacency derived from the corridors, so the rules cannot disagree with the drawing. */
export function adjacencyOf(map: ShipMap): Record<number, number[]> {
  const adjacency: Record<number, number[]> = {};
  for (const room of map.rooms) adjacency[room.id] = [];
  for (const [a, b] of map.corridors) {
    adjacency[a]?.push(b);
    adjacency[b]?.push(a);
  }
  return adjacency;
}

export function ventsOf(map: ShipMap): Record<number, number[]> {
  const vents: Record<number, number[]> = {};
  for (const room of map.rooms) vents[room.id] = [];
  for (const [a, b] of map.vents) {
    vents[a]?.push(b);
    vents[b]?.push(a);
  }
  return vents;
}

export function taskRoomsOf(map: ShipMap): number[] {
  return map.rooms.filter((room) => room.hasTasks).map((room) => room.id);
}

export function roomOf(map: ShipMap, id: number): RoomSpec | undefined {
  return map.rooms.find((room) => room.id === id);
}

export function roomNameOf(map: ShipMap, id: number): string {
  return roomOf(map, id)?.name ?? `Room ${id}`;
}

export function centreOf(map: ShipMap, id: number): { x: number; y: number } {
  const room = roomOf(map, id);
  if (!room) return { x: 0, y: 0 };
  return { x: room.x + room.width / 2, y: room.y + room.height / 2 };
}

/** First step of the shortest path, used by agents and by the client's click-to-move. */
export function stepToward(map: ShipMap, from: number, to: number): number {
  if (from === to) return from;
  const adjacency = adjacencyOf(map);
  const seen = new Set<number>([from]);
  const queue: Array<{ node: number; first: number }> = [];
  for (const next of adjacency[from] ?? []) {
    queue.push({ node: next, first: next });
    seen.add(next);
  }
  while (queue.length > 0) {
    const { node, first } = queue.shift()!;
    if (node === to) return first;
    for (const next of adjacency[node] ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ node: next, first });
    }
  }
  return (adjacency[from] ?? [from])[0] ?? from;
}

/** Every room reachable from `from`, used to check a map is not accidentally severed. */
export function reachableFrom(map: ShipMap, from: number): Set<number> {
  const adjacency = adjacencyOf(map);
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    for (const next of adjacency[queue.shift()!] ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
