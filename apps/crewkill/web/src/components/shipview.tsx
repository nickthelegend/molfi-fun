"use client";

import {
  adjacencyOf,
  centreOf,
  ventsOf,
  type Fixture,
  type MatchView,
  type RoomSpec,
  type ShipMap,
} from"@crewkill/protocol";
import { useEffect, useMemo, useRef, useState } from"react";
import { Crewmate, DeadBody } from"./sprite";

/**
 * Draws any ship from its spec.
 *
 * One renderer for all three vessels, because the alternative - hand-drawing each - is how
 * the previous map ended up as 2,670 lines that only ever described one hull. Everything
 * here reads from the `ShipMap` the keeper also uses for its rules, so a corridor you can
 * see is a corridor you can walk.
 */
/**
 * A corridor that only ever runs horizontally or vertically.
 *
 * Straight when the two rooms share a row or a column, which the grid makes the common
 * case. Otherwise it turns once, going along the longer axis first so the elbow lands away
 * from the room it is leaving rather than immediately outside its door.
 */
function corridorPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const ALIGNED = 30;

  if (dx <= ALIGNED) return `M ${from.x} ${from.y} L ${from.x} ${to.y}`;
  if (dy <= ALIGNED) return `M ${from.x} ${from.y} L ${to.x} ${from.y}`;

  return dx >= dy
    ? `M ${from.x} ${from.y} L ${to.x} ${from.y} L ${to.x} ${to.y}`
    : `M ${from.x} ${from.y} L ${from.x} ${to.y} L ${to.x} ${to.y}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function ShipView({
  map,
  match,
  yourSeat,
  onRoomClick,
}: {
  map: ShipMap;
  match: MatchView;
  yourSeat: number | null;
  onRoomClick?: (roomId: number) => void;
}) {
  const [box, setBox] = useState({ w: 1280, h: 800 });
  const shell = useRef<HTMLDivElement>(null);

  /*
   * The whole ship by default, with a camera you can reach for.
   *
   * This was a fixed frame with no controls at all, on the reasoning that a player in a
   * meeting should not be managing a camera. That holds for the default - which is still
   * the entire ship, framed from what the rooms actually occupy - but it left no way to
   * lean in on a corner during a night phase, and on a narrow window the whole hull at once
   * is too small to read who is where.
   *
   * So: the fit-everything frame is where you start and where one key returns you, and zoom
   * is available when you want it. The camera never moves on its own.
   */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const fit = useMemo(() => {
    const xs = map.rooms.map((r) => r.x);
    const ys = map.rooms.map((r) => r.y);
    const x2 = map.rooms.map((r) => r.x + r.width);
    const y2 = map.rooms.map((r) => r.y + r.height);
    const pad = 220;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return {
      x: minX,
      y: minY,
      w: Math.max(...x2) + pad - minX,
      h: Math.max(...y2) + pad - minY,
    };
  }, [map]);

  /**
   * The frame actually drawn: the fit box, scaled about its centre and shifted by the pan.
   *
   * Zooming about the centre rather than the top left is what makes the buttons feel like a
   * camera instead of a scrollbar - the thing you were looking at stays where it was.
   */
  const frame = useMemo(() => {
    const w = fit.w / zoom;
    const h = fit.h / zoom;
    return {
      x: fit.x + (fit.w - w) / 2 + pan.x,
      y: fit.y + (fit.h - h) / 2 + pan.y,
      w,
      h,
    };
  }, [fit, zoom, pan]);

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Keyboard camera. Plus and minus zoom, 0 returns to the whole ship, arrows pan when
  // zoomed in. Dropped while a text field has focus so typing never moves the view.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;

      const step = fit.w / (zoom * 8);
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((z) => clampZoom(z * 1.35));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((z) => clampZoom(z / 1.35));
      } else if (event.key === "0") {
        event.preventDefault();
        resetView();
      } else if (zoom > 1 && event.key.startsWith("Arrow")) {
        event.preventDefault();
        setPan((p) => ({
          x: p.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
          y: p.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
        }));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit.w, zoom]);

  const adjacency = useMemo(() => adjacencyOf(map), [map]);
  const vents = useMemo(() => ventsOf(map), [map]);

  const me = yourSeat !== null ? match.seats[yourSeat] : undefined;
  const reachable = me?.alive && match.roundPhase ==="night" ? (adjacency[me.location] ?? []) : [];
  const ventable = me?.alive && match.roundPhase ==="night" ? (vents[me.location] ?? []) : [];

  const occupants = useMemo(() => {
    const byRoom = new Map<number, MatchView["seats"]>();
    for (const seat of match.seats) {
      if (!seat.alive) continue;
      byRoom.set(seat.location, [...(byRoom.get(seat.location) ?? []), seat]);
    }
    return byRoom;
  }, [match.seats]);

  const bodies = useMemo(() => {
    const byRoom = new Map<number, MatchView["bodies"]>();
    for (const body of match.bodies) {
      byRoom.set(body.location, [...(byRoom.get(body.location) ?? []), body]);
    }
    return byRoom;
  }, [match.bodies]);

  // Keep the window matched to the element, so the ship never stretches.
  useEffect(() => {
    const node = shell.current;
    if (!node) return;
    const measure = () => {
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBox({ w: r.width, h: r.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const lightsOut = match.sabotage === 1;

  return (
    <div
      ref={shell}
      className="relative h-full w-full select-none overflow-hidden"
      style={{
        background:"radial-gradient(ellipse at center, var(--hull-map-near), var(--hull-map-far))",
      }}
    >
      {/* Camera controls.

          Bottom-left, small, and out of the way of the ship. Fit is always reachable in one
          click and one key, so zooming in is never a state you can get stuck in. */}
      <div className="pointer-events-auto absolute bottom-3 left-3 z-20 flex items-center gap-1">
        <button
          onClick={() => setZoom((z) => clampZoom(z / 1.35))}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
          title="Zoom out  (−)"
          className="cam-btn"
        >
          −
        </button>
        <button
          onClick={() => setZoom((z) => clampZoom(z * 1.35))}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          title="Zoom in  (+)"
          className="cam-btn"
        >
          +
        </button>
        <button
          onClick={resetView}
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
          aria-label="Fit the whole ship"
          title="Fit the whole ship  (0)"
          className="cam-btn w-auto px-2 text-[10px] tracking-wider"
        >
          FIT
        </button>
        {zoom !== 1 && (
          <span className="numeric ml-1 text-[10px] text-[var(--color-dim)]">
            {zoom.toFixed(1)}x
          </span>
        )}
      </div>

      <svg
        viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={(event) => {
          // Wheel zooms rather than scrolling the page, which is what a map is expected to
          // do. Trackpad pinch arrives here as a ctrl-wheel and is handled the same way.
          if (event.deltaY === 0) return;
          setZoom((z) => clampZoom(z * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
        }}
        className="block h-full w-full "
        role="img"
        aria-label={`${map.name}: ${match.seatsFilled} seats, showing where each is`}
      >
        <defs>
          <FloorPatterns />
          {/* Deck grating for corridors: thin ribs across the run. */}
          <pattern id="grating" width="26" height="26" patternUnits="userSpaceOnUse">
            <rect width="26" height="26" fill="none" />
            <rect x="0" y="0" width="26" height="7" fill="#000" fillOpacity="0.30" />
          </pattern>
          {/* Rooms are lit from above, so the floor darkens toward the far wall. */}
          <linearGradient id="roomDepth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="55%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.28" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="14" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g>
          {/* Corridors, routed on the square.
              Rooms sit on a grid, so a connected pair usually shares a row or a column and
              the run between them is simply straight. Where it does not, the corridor turns
              once at a right angle rather than cutting across the hull on a diagonal, which
              is what made runs cross each other. */}
          {map.corridors.map(([a, b]) => {
            const from = centreOf(map, a);
            const to = centreOf(map, b);
            const d = corridorPath(from, to);
            return (
              <g key={`c-${a}-${b}`} fill="none" strokeLinecap="butt" strokeLinejoin="miter">
                <path d={d} stroke="var(--corridor-shell)" strokeWidth={138} />
                <path d={d} stroke="var(--corridor-wall)" strokeWidth={124} />
                <path d={d} stroke="var(--corridor-deck)" strokeWidth={108} />
                <path d={d} stroke="url(#grating)" strokeWidth={108} />
                <path d={d} stroke="#e8b23a" strokeWidth={4} strokeDasharray="52 40" opacity={0.42} />
              </g>
            );
          })}

          {/* Vents, drawn faintly so they read as a shortcut that exists rather than a path. */}
          {map.vents.map(([a, b]) => {
            const from = centreOf(map, a);
            const to = centreOf(map, b);
            const isMine = ventable.includes(b) || ventable.includes(a);
            return (
              <line
                key={`v-${a}-${b}`}
                x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={isMine ?"var(--color-alarm)" :"#3a2030"}
                strokeWidth={isMine ? 8 : 5}
                strokeDasharray="16 30"
                opacity={isMine ? 0.85 : 0.4}
              />
            );
          })}

          {map.rooms.map((room) => (
            <Room
              key={room.id}
              room={room}
              match={match}
              yourSeat={yourSeat}
              occupants={occupants.get(room.id) ?? []}
              bodies={bodies.get(room.id) ?? []}
              highlighted={reachable.includes(room.id)}
              ventTarget={ventable.includes(room.id)}
              sabotaged={match.sabotage > 0 && isFixRoom(map, match.sabotage, room.id)}
              onClick={onRoomClick}
            />
          ))}
        </g>
      </svg>

      {lightsOut && (
        <div className="pointer-events-none absolute inset-0 bg-[var(--void)] opacity-70" />
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <div className="pointer-events-auto border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 py-1.5">
          <div className="tele text-[var(--color-cyan)]">
            {map.name}
          </div>
          <div className="text-[10px] text-[var(--color-dim)]">{map.tagline}</div>
        </div>
      </div>

    </div>
  );
}

function isFixRoom(map: ShipMap, sabotage: number, roomId: number): boolean {
  // Lights are fixed in the room with the wiring; the rest at their own consoles.
  const byKind: Record<number, string[]> = {
    1: ["wiring"],
    2: ["reactor"],
    3: ["oxygen"],
    4: ["server"],
  };
  const kinds = byKind[sabotage] ?? [];
  const room = map.rooms.find((r) => r.id === roomId);
  return room ? room.fixtures.some((f) => kinds.includes(f.kind)) : false;
}

function Room({
  room,
  match,
  yourSeat,
  occupants,
  bodies,
  highlighted,
  ventTarget,
  sabotaged,
  onClick,
}: {
  room: RoomSpec;
  match: MatchView;
  yourSeat: number | null;
  occupants: MatchView["seats"];
  bodies: MatchView["bodies"];
  highlighted: boolean;
  ventTarget: boolean;
  sabotaged: boolean;
  onClick?: (roomId: number) => void;
}) {
  const youHere = occupants.some((seat) => seat.index === yourSeat);
  const stroke = sabotaged
    ?"var(--color-alarm)"
    : youHere
      ?"var(--color-cyan)"
      : highlighted
        ?"rgba(86,211,240,0.6)"
        : ventTarget
          ?"rgba(242,85,90,0.5)"
          :"#26304a";

  return (
    <g
      onClick={highlighted && onClick ? () => onClick(room.id) : undefined}
      style={{ cursor: highlighted ?"pointer" :"default" }}
    >
      {/* Floor. */}
      <rect
        x={room.x} y={room.y} width={room.width} height={room.height}
        fill={room.floor}
      />
      <rect
        x={room.x} y={room.y} width={room.width} height={room.height}
        fill={`url(#floor-${room.pattern})`} opacity={0.5}
      />

      {/* Hull plating: panel seams across the deck, so a room reads as built in
          sections rather than painted one colour. Ported from the original map's
          HullPanel, generalised so every ship gets it. */}
      <HullPlating room={room} />

      {/* Lit from above. */}
      <rect
        x={room.x} y={room.y} width={room.width} height={room.height}
        fill="url(#roomDepth)" pointerEvents="none"
      />

      {/* Walls: a thick outer hull with a lighter inner lip. */}
      <rect
        x={room.x} y={room.y} width={room.width} height={room.height}
        fill="none" stroke={room.wall} strokeWidth={18}
      />
      <rect
        x={room.x + 9} y={room.y + 9} width={room.width - 18} height={room.height - 18}
        fill="none" stroke="#ffffff" strokeOpacity={0.07} strokeWidth={2}
      />

      {/* Wall lights along the top edge. */}
      <WallLights room={room} />

      {/* Selection and fault states sit on top of the hull. */}
      <rect
        x={room.x} y={room.y} width={room.width} height={room.height}
        fill="none" stroke={stroke}
        strokeWidth={sabotaged || youHere || highlighted ? 9 : 3}
        className={sabotaged ?"room-alarm" : undefined}
      />

      {room.fixtures.map((fixture, i) => (
        <FixtureShape key={i} fixture={fixture} originX={room.x} originY={room.y} />
      ))}

      <text
        x={room.x + 26} y={room.y + 46}
        fill={sabotaged ?"var(--color-alarm)" :"var(--room-label)"}
        fontSize={34} letterSpacing={4} style={{ textTransform:"uppercase" }}
      >
        {room.name}
      </text>

      {bodies.map((body, i) => (
        <foreignObject
          key={`b-${body.victim}`}
          x={room.x + 40 + i * 90} y={room.y + room.height - 110}
          width={90} height={80}
        >
          <DeadBody seatIndex={body.victim} size={72} />
        </foreignObject>
      ))}

      {occupants.map((seat, i) => {
        const perRow = Math.min(occupants.length, 3);
        const spacing = room.width / (perRow + 1);
        const row = Math.floor(i / 3);
        const x = room.x + spacing * ((i % 3) + 1);
        const y = room.y + room.height * 0.6 + row * 120;
        return (
          <foreignObject
            key={seat.index}
            x={x - 55} y={y - 70} width={110} height={150}
            style={{ transition:"x 600ms ease, y 600ms ease" }}
          >
            <Crewmate
              seatIndex={seat.index}
              size={92}
              alive
              moving={match.roundPhase ==="night"}
              name={seat.persona}
              showName
              highlight={seat.index === yourSeat}
              onCameras={seat.onCameras}
            />
          </foreignObject>
        );
      })}
    </g>
  );
}

/**
 * Panel seams and rivets across a room's deck.
 *
 * Ported from the original map's `HullPanel`, but derived from the room's own
 * dimensions instead of hand-placed, so it works on any ship rather than only the
 * hull it was drawn for.
 */
function HullPlating({ room }: { room: RoomSpec }) {
  const panel = 190;
  const cols = Math.max(1, Math.round(room.width / panel));
  const rows = Math.max(1, Math.round(room.height / panel));
  const w = room.width / cols;
  const h = room.height / rows;

  const seams: React.ReactNode[] = [];
  for (let c = 1; c < cols; c += 1) {
    seams.push(
      <line
        key={`v${c}`}
        x1={room.x + c * w} y1={room.y + 10}
        x2={room.x + c * w} y2={room.y + room.height - 10}
        stroke="#000" strokeOpacity={0.22} strokeWidth={2}
      />,
    );
  }
  for (let r = 1; r < rows; r += 1) {
    seams.push(
      <line
        key={`h${r}`}
        x1={room.x + 10} y1={room.y + r * h}
        x2={room.x + room.width - 10} y2={room.y + r * h}
        stroke="#000" strokeOpacity={0.22} strokeWidth={2}
      />,
    );
  }

  // A rivet at each panel corner, which is most of what sells "plated metal".
  const rivets: React.ReactNode[] = [];
  for (let c = 0; c <= cols; c += 1) {
    for (let r = 0; r <= rows; r += 1) {
      const cx = room.x + Math.min(Math.max(c * w, 14), room.width - 14);
      const cy = room.y + Math.min(Math.max(r * h, 14), room.height - 14);
      rivets.push(
        <circle key={`r${c}-${r}`} cx={cx} cy={cy} r={3.4} fill="#fff" fillOpacity={0.12} />,
      );
    }
  }

  return (
    <g pointerEvents="none">
      {seams}
      {rivets}
    </g>
  );
}

/**
 * Strip lights along a room's top wall.
 *
 * The original used framer-motion to breathe them. Here they are static by default and
 * only pulse when the room is dark, because a light that flickers for no reason is
 * decoration, and a light that flickers during a lights-out sabotage is information.
 */
function WallLights({ room }: { room: RoomSpec }) {
  const count = Math.max(2, Math.round(room.width / 260));
  const gap = room.width / (count + 1);
  return (
    <g pointerEvents="none">
      {Array.from({ length: count }).map((_unused, i) => (
        <rect
          key={i}
          x={room.x + gap * (i + 1) - 16}
          y={room.y + 11}
          width={32}
          height={6}
          fill="#ffe9b8"
          opacity={0.5}
        />
      ))}
    </g>
  );
}

/** Floor treatments. A grated engine room should not read like a smooth medbay. */
function FloorPatterns() {
  return (
    <>
      <pattern id="floor-tile" width="90" height="90" patternUnits="userSpaceOnUse">
        <rect width="90" height="90" fill="none" />
        <path d="M0 0H90M0 0V90" stroke="#000" strokeOpacity="0.22" strokeWidth="3" />
      </pattern>
      <pattern id="floor-grate" width="46" height="46" patternUnits="userSpaceOnUse">
        <rect width="46" height="46" fill="none" />
        <path d="M0 23H46" stroke="#000" strokeOpacity="0.35" strokeWidth="7" />
      </pattern>
      <pattern id="floor-plate" width="130" height="130" patternUnits="userSpaceOnUse">
        <rect width="130" height="130" fill="none" />
        <rect x="8" y="8" width="114" height="114" rx="8" fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth="4" />
      </pattern>
      <pattern id="floor-hazard" width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="40" height="80" fill="#000" fillOpacity="0.22" />
      </pattern>
      <pattern id="floor-smooth" width="120" height="120" patternUnits="userSpaceOnUse">
        <circle cx="60" cy="60" r="2.5" fill="#fff" fillOpacity="0.12" />
      </pattern>
    </>
  );
}

/** One fixture, drawn as the thing it is. */
function FixtureShape({
  fixture,
  originX,
  originY,
}: {
  fixture: Fixture;
  originX: number;
  originY: number;
}) {
  const x = originX + fixture.x;
  const y = originY + fixture.y;
  const w = fixture.w ?? 60;
  const h = fixture.h ?? 60;

  switch (fixture.kind) {
    case"console":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={10} fill="#22304a" stroke="#0d1524" strokeWidth={7} />
          <rect x={x + 12} y={y + 12} width={w - 24} height={h - 34} rx={6} fill="#0c2a2a" />
          <rect x={x + 20} y={y + 22} width={(w - 40) * 0.7} height={7} fill="#4ade80" opacity={0.8} />
          <rect x={x + 20} y={y + 38} width={(w - 40) * 0.45} height={7} fill="#56d3f0" opacity={0.7} />
        </g>
      );
    case"table":
      return (
        <g>
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="#3b4a63" stroke="#0d1524" strokeWidth={8} />
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2 - 26} ry={h / 2 - 26} fill="#4b5c79" />
        </g>
      );
    case"crate":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={8} fill="#7a5a2e" stroke="#0d1524" strokeWidth={7} />
          <path d={`M${x} ${y} L${x + w} ${y + h} M${x + w} ${y} L${x} ${y + h}`} stroke="#8f6c38" strokeWidth={6} />
        </g>
      );
    case"reactor":
      return (
        <g filter="url(#glow)">
          <circle cx={x + w / 2} cy={y + h / 2} r={w / 2} fill="#2a1418" stroke="#0d1524" strokeWidth={8} />
          <circle cx={x + w / 2} cy={y + h / 2} r={w / 3} fill="#f2555a" opacity={0.75} />
          <circle cx={x + w / 2} cy={y + h / 2} r={w / 6} fill="#ffd6a8" />
        </g>
      );
    case"engine":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={26} fill="#3a2a2a" stroke="#0d1524" strokeWidth={8} />
          <circle cx={x + w * 0.32} cy={y + h / 2} r={h * 0.26} fill="#f5b544" opacity={0.6} />
          <circle cx={x + w * 0.68} cy={y + h / 2} r={h * 0.26} fill="#f5b544" opacity={0.6} />
        </g>
      );
    case"medpod":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={w / 2} fill="#2c4a44" stroke="#0d1524" strokeWidth={7} />
          <rect x={x + 12} y={y + 24} width={w - 24} height={h - 48} rx={w / 2} fill="#7fe3d0" opacity={0.35} />
        </g>
      );
    case"wiring":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={8} fill="#2a2a18" stroke="#0d1524" strokeWidth={7} />
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M${x + 16} ${y + 30 + i * 40} q ${w / 3} -26 ${w - 32} 0`}
              stroke={["#f2555a","#56d3f0","#4ade80","#f5b544"][i]}
              strokeWidth={8} fill="none" opacity={0.85}
            />
          ))}
        </g>
      );
    case"oxygen":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={w / 2} fill="#2a4a44" stroke="#0d1524" strokeWidth={7} />
          <rect x={x + 14} y={y + h * 0.25} width={w - 28} height={h * 0.55} rx={w / 3} fill="#56d3f0" opacity={0.45} />
        </g>
      );
    case"server":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={8} fill="#1d2438" stroke="#0d1524" strokeWidth={7} />
          {Array.from({ length: Math.max(2, Math.floor(h / 46)) }).map((_u, i) => (
            <g key={i}>
              <rect x={x + 12} y={y + 16 + i * 42} width={w - 24} height={26} rx={4} fill="#2b3552" />
              <circle cx={x + w - 24} cy={y + 29 + i * 42} r={5} fill={i % 2 ?"#4ade80" :"#f5b544"} />
            </g>
          ))}
        </g>
      );
    case"camera":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={10} fill="#161d2e" stroke="#0d1524" strokeWidth={7} />
          <rect x={x + 14} y={y + 14} width={w - 28} height={h - 28} rx={6} fill="#0a1a12" />
          {Array.from({ length: 4 }).map((_u, i) => (
            <rect
              key={i}
              x={x + 24 + (i % 2) * ((w - 48) / 2 + 8)}
              y={y + 24 + Math.floor(i / 2) * ((h - 48) / 2 + 8)}
              width={(w - 56) / 2} height={(h - 56) / 2} rx={4}
              fill="#1d5c3a" opacity={0.8}
            />
          ))}
        </g>
      );
    case"vent":
      return (
        <g>
          <rect x={x} y={y} width={54} height={54} rx={8} fill="#151b28" stroke="#0d1524" strokeWidth={6} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={x + 10} y={y + 12 + i * 14} width={34} height={6} rx={3} fill="#39445e" />
          ))}
        </g>
      );
    case"locker":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={8} fill="#2b3450" stroke="#0d1524" strokeWidth={7} />
          <line x1={x + w / 2} y1={y + 10} x2={x + w / 2} y2={y + h - 10} stroke="#0d1524" strokeWidth={5} />
          <circle cx={x + w / 2 - 14} cy={y + h / 2} r={5} fill="#8fa0c4" />
          <circle cx={x + w / 2 + 14} cy={y + h / 2} r={5} fill="#8fa0c4" />
        </g>
      );
    case"window":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={12} fill="#050a14" strokeWidth={0} />
          <rect x={x} y={y} width={w} height={h} rx={12} fill="none" stroke="#2b3450" strokeWidth={9} />
          {Array.from({ length: 6 }).map((_u, i) => (
            <circle
              key={i}
              cx={x + 18 + ((i * 37) % Math.max(1, w - 36))}
              cy={y + 16 + ((i * 23) % Math.max(1, h - 32))}
              r={2.6} fill="#fff" opacity={0.7}
            />
          ))}
        </g>
      );
    case"pipe":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="#2a3346" stroke="#0d1524" strokeWidth={6} />
          {Array.from({ length: Math.max(2, Math.floor(w / 120)) }).map((_u, i) => (
            <rect key={i} x={x + 40 + i * 120} y={y - 5} width={14} height={h + 10} rx={4} fill="#39445e" />
          ))}
        </g>
      );
    default:
      return null;
  }
}
