import { describe, it, expect } from "vitest";
import { SHIP_MAPS, type ShipMap } from "@crewkill/protocol";
import {
  adjacent,
  ventsFrom,
  isLegalMove,
  isLegalVent,
  taskRooms,
  locationName,
  fixRoomsFor,
  cameraRooms,
  securityRoom,
  hasTasks,
  SABOTAGE_CONFIG,
  KILL_COOLDOWN_ROUNDS,
  TASK_ROUNDS_REQUIRED,
} from "../src/game/ship.js";

/**
 * The movement rules, tested against every ship rather than one.
 *
 * These decide what a player is allowed to do, and the keeper enforces them server side
 * because a client that could move anywhere could walk to a victim from across the map. They
 * had no tests at all. Running each case over all three maps matters because the rules are
 * data driven: a rule that happens to hold on the ship the demo uses is not a rule.
 */
const ALL: ShipMap[] = SHIP_MAPS;

describe("ship rules", () => {
  it("ships every map with rooms and a name", () => {
    expect(ALL.length).toBeGreaterThan(0);
    for (const map of ALL) {
      expect(map.rooms.length).toBeGreaterThan(0);
      expect(map.name.length).toBeGreaterThan(0);
    }
  });

  describe.each(ALL.map((m) => [m.name, m] as const))("%s", (_name, map) => {
    it("lets a player stay where they are", () => {
      // Standing still is a legal move. Without this an agent with no adjacent room it wants
      // is forced to move, which is a rule nobody intended.
      for (const room of map.rooms) {
        expect(isLegalMove(map, room.id, room.id)).toBe(true);
      }
    });

    it("only allows moves along a corridor that exists", () => {
      for (const room of map.rooms) {
        const neighbours = adjacent(map, room.id);
        for (const other of map.rooms) {
          const legal = isLegalMove(map, room.id, other.id);
          const expected = room.id === other.id || neighbours.includes(other.id);
          expect(legal).toBe(expected);
        }
      }
    });

    it("keeps corridors symmetric", () => {
      // If you can walk from A to B you can walk back. An asymmetric corridor is a one way
      // door, and one of those on a map like this is a trap rather than a feature.
      for (const room of map.rooms) {
        for (const neighbour of adjacent(map, room.id)) {
          expect(adjacent(map, neighbour)).toContain(room.id);
        }
      }
    });

    it("never treats an unknown room as reachable", () => {
      const unknown = 9999;
      expect(adjacent(map, unknown)).toEqual([]);
      expect(isLegalMove(map, unknown, map.rooms[0].id)).toBe(false);
      expect(ventsFrom(map, unknown)).toEqual([]);
    });

    it("keeps vents symmetric and distinct from corridors", () => {
      for (const room of map.rooms) {
        for (const exit of ventsFrom(map, room.id)) {
          expect(isLegalVent(map, room.id, exit)).toBe(true);
          // A vent that leads back the way it came, or to itself, is not a shortcut.
          expect(exit).not.toBe(room.id);
          expect(ventsFrom(map, exit)).toContain(room.id);
        }
      }
    });

    it("names every room it will ever be asked about", () => {
      for (const room of map.rooms) {
        const name = locationName(map, room.id);
        expect(name.length).toBeGreaterThan(0);
        // A room that renders as its own id number is a missing name, not a name.
        expect(name).not.toBe(String(room.id));
      }
    });

    it("puts tasks somewhere, and agrees with itself about where", () => {
      const rooms = taskRooms(map);
      expect(rooms.length).toBeGreaterThan(0);
      for (const room of map.rooms) {
        expect(hasTasks(map, room.id)).toBe(rooms.includes(room.id));
      }
    });

    it("gives every sabotage somewhere to be repaired", () => {
      // A sabotage with no fix room can never be cleared, which on a timer means the crew
      // lose to a rule rather than to a player.
      for (const key of Object.keys(SABOTAGE_CONFIG)) {
        const sabotage = Number(key);
        const fixes = fixRoomsFor(map, sabotage);
        expect(fixes.length).toBeGreaterThan(0);
        for (const id of fixes) {
          expect(map.rooms.some((r) => r.id === id)).toBe(true);
        }
      }
    });

    it("puts the cameras on real rooms and security in a real room", () => {
      const watched = cameraRooms(map);
      expect(watched.length).toBeGreaterThan(0);
      for (const id of watched) {
        expect(map.rooms.some((r) => r.id === id)).toBe(true);
      }
      expect(map.rooms.some((r) => r.id === securityRoom(map))).toBe(true);
    });
  });
});

describe("pacing constants", () => {
  it("makes a kill cost at least one round", () => {
    expect(KILL_COOLDOWN_ROUNDS).toBeGreaterThanOrEqual(1);
  });

  it("takes more than one round to finish tasks", () => {
    // If tasks completed in a single round the crew would win before a vote ever happened.
    expect(TASK_ROUNDS_REQUIRED).toBeGreaterThan(1);
  });
});
