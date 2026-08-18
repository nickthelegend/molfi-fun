/**
 * A map that looks good but plays badly is worse than no map. These are the properties that
 * make a ship playable at all: it must be connected, its rooms must not overlap, vents must
 * be an impostor advantage rather than a copy of the corridors, and there must be somewhere
 * to work and somewhere to watch from.
 */

import { describe, expect, it } from "vitest";
import {
  SHIP_MAPS,
  adjacencyOf,
  reachableFrom,
  shipMapForSeed,
  stepToward,
  taskRoomsOf,
  ventsOf,
} from "../src/maps";

describe.each(SHIP_MAPS.map((m) => [m.name, m] as const))("%s", (_name, map) => {
  it("is fully connected — no room is stranded", () => {
    const reachable = reachableFrom(map, map.spawnRoom);
    const unreachable = map.rooms.filter((r) => !reachable.has(r.id)).map((r) => r.name);
    expect(unreachable).toEqual([]);
  });

  it("has no room adjacent to itself and no duplicate corridors", () => {
    const seen = new Set<string>();
    for (const [a, b] of map.corridors) {
      expect(a).not.toBe(b);
      const key = [a, b].sort((x, y) => x - y).join("-");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("only connects rooms that exist", () => {
    const ids = new Set(map.rooms.map((r) => r.id));
    for (const [a, b] of [...map.corridors, ...map.vents]) {
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
    }
  });

  it("keeps its rooms inside the hull and out of each other", () => {
    for (const room of map.rooms) {
      expect(room.x).toBeGreaterThanOrEqual(0);
      expect(room.y).toBeGreaterThanOrEqual(0);
      expect(room.x + room.width).toBeLessThanOrEqual(map.width);
      expect(room.y + room.height).toBeLessThanOrEqual(map.height);
    }
    for (let i = 0; i < map.rooms.length; i += 1) {
      for (let j = i + 1; j < map.rooms.length; j += 1) {
        const a = map.rooms[i];
        const b = map.rooms[j];
        const overlaps =
          a.x < b.x + b.width && b.x < a.x + a.width &&
          a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlaps, `${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });

  it("gives vents a route the corridors do not already provide", () => {
    const adjacency = adjacencyOf(map);
    // At least one vent must be a genuine shortcut, or venting is pure decoration.
    const shortcuts = map.vents.filter(([a, b]) => !(adjacency[a] ?? []).includes(b));
    expect(shortcuts.length).toBeGreaterThan(0);
  });

  it("has somewhere to work, somewhere to watch, and somewhere to start", () => {
    expect(taskRoomsOf(map).length).toBeGreaterThanOrEqual(4);
    expect(map.cameraRooms.length).toBeGreaterThanOrEqual(3);
    expect(map.rooms.some((r) => r.id === map.securityRoom)).toBe(true);
    expect(map.rooms.some((r) => r.id === map.spawnRoom)).toBe(true);
  });

  it("routes between every pair of rooms in finite steps", () => {
    for (const from of map.rooms) {
      for (const to of map.rooms) {
        if (from.id === to.id) continue;
        let at = from.id;
        let guard = 0;
        while (at !== to.id && guard < 40) {
          at = stepToward(map, at, to.id);
          guard += 1;
        }
        expect(at, `${from.name} -> ${to.name}`).toBe(to.id);
      }
    }
  });

  it("gives every room some furniture", () => {
    for (const room of map.rooms) {
      expect(room.fixtures.length, `${room.name} is empty`).toBeGreaterThan(0);
    }
  });

  it("keeps fixtures inside their room", () => {
    for (const room of map.rooms) {
      for (const fixture of room.fixtures) {
        expect(fixture.x).toBeGreaterThanOrEqual(0);
        expect(fixture.y).toBeGreaterThanOrEqual(0);
        expect(fixture.x + (fixture.w ?? 40)).toBeLessThanOrEqual(room.width);
        expect(fixture.y + (fixture.h ?? 40)).toBeLessThanOrEqual(room.height);
      }
    }
  });
});

describe("map selection", () => {
  it("is decided by the seed, not by the operator", () => {
    const picks = new Set<string>();
    for (let i = 0; i < 60; i += 1) picks.add(shipMapForSeed(BigInt(i)).id);
    expect(picks.size).toBe(SHIP_MAPS.length);
  });

  it("is deterministic for a given seed", () => {
    expect(shipMapForSeed(12345n).id).toBe(shipMapForSeed(12345n).id);
  });
});

describe("the three ships are actually different", () => {
  it("have distinct ids, names and shapes", () => {
    expect(new Set(SHIP_MAPS.map((m) => m.id)).size).toBe(SHIP_MAPS.length);
    expect(new Set(SHIP_MAPS.map((m) => m.name)).size).toBe(SHIP_MAPS.length);
  });

  it("differ in how connected they are, so they play differently", () => {
    const density = SHIP_MAPS.map((m) => m.corridors.length / m.rooms.length);
    // A ring circulates more than a shaft; if these were equal the maps would be reskins.
    expect(Math.max(...density) - Math.min(...density)).toBeGreaterThan(0.1);
  });
});

/**
 * Every sabotage needs somewhere it can be repaired.
 *
 * A sabotage is defined by the fixture that clears it, and the keeper looks for that fixture
 * across the map's rooms. If no room has one, the sabotage fires and can never be cleared:
 * on a non critical one the ship simply stays broken for the rest of the match, and on a
 * critical one the crew lose to a timer they were never able to stop.
 *
 * This shipped. Kuiper Relay had no wiring panel anywhere, so its lights could never come
 * back on, and Deep Core had neither wiring nor a server, so lights and comms were both
 * permanently broken. Only Obsidian Prime was complete, and Obsidian Prime is the map the
 * demo opens on, which is exactly why nobody noticed.
 *
 * The list below is duplicated from the keeper's SABOTAGE_CONFIG on purpose. Importing it
 * would make this test pass automatically if a sabotage were ever removed from the config to
 * work around a missing fixture, which is the failure this is meant to catch.
 */
const REPAIR_FIXTURES: Array<{ sabotage: string; fixture: string }> = [
  { sabotage: "Lights", fixture: "wiring" },
  { sabotage: "Reactor meltdown", fixture: "reactor" },
  { sabotage: "O2 depletion", fixture: "oxygen" },
  { sabotage: "Comms sabotage", fixture: "server" },
];

describe("every map can repair every sabotage", () => {
  for (const map of SHIP_MAPS) {
    for (const { sabotage, fixture } of REPAIR_FIXTURES) {
      it(`${map.name} can fix ${sabotage.toLowerCase()}`, () => {
        const rooms = map.rooms.filter((room) =>
          room.fixtures.some((f) => f.kind === fixture),
        );
        expect(
          rooms.length,
          `${map.name} has no room with a ${fixture} fixture, so ${sabotage} can never be repaired`,
        ).toBeGreaterThan(0);
      });
    }
  }
});
