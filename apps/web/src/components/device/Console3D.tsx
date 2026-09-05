"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, type Group } from "three";
import { CONSOLE_MATERIALS, buildConsole } from "@molfi/sdk";

/**
 * The molfi console in WebGL.
 *
 * The geometry is built in-process from the shared definition in @molfi/sdk — the same
 * one tools/model/build-model.mjs serialises to xorr-console.glb. Nothing is fetched
 * and nothing is parsed at runtime.
 *
 * That is deliberate. Loading the shape as a .glb meant a Suspense boundary waiting on
 * a network fetch and a GLTF loader that quietly pulls DRACO and Meshopt decoders from
 * a CDN; where that CDN is unreachable the loader never settles, Suspense never
 * resolves, and the hero renders as an empty rectangle with no error to show for it.
 * A procedural model has no reason to make that round trip. The .glb is still
 * generated as an artifact for anyone who wants the asset.
 */
function useConsoleGeometry() {
  return useMemo(() => {
    return buildConsole().map((m) => {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(Float32Array.from(m.positions), 3));
      g.setAttribute("normal", new BufferAttribute(Float32Array.from(m.normals), 3));
      g.setIndex(new BufferAttribute(Uint32Array.from(m.indices), 1));
      g.computeBoundingSphere();

      const def = CONSOLE_MATERIALS[m.material];
      return { key: m.name, geometry: g, def };
    });
  }, []);
}

function ConsoleModel({ spin = true }: { spin?: boolean }) {
  const parts = useConsoleGeometry();
  const ref = useRef<Group>(null);

  useFrame((s) => {
    if (!ref.current || !spin) return;
    const t = s.clock.elapsedTime;
    // Held in a hand, not on a turntable: a small tilt, never a full revolution.
    ref.current.rotation.y = Math.sin(t * 0.36) * 0.34;
    ref.current.rotation.x = -0.06 + Math.sin(t * 0.28) * 0.05;
    ref.current.position.y = Math.sin(t * 0.6) * 0.018;
  });

  return (
    <group ref={ref} scale={1.06}>
      {parts.map((p) => (
        <mesh key={p.key} geometry={p.geometry}>
          <meshStandardMaterial
            color={p.def.color}
            metalness={p.def.metallic}
            roughness={p.def.roughness}
            emissive={p.def.emissive ? new Color(...p.def.emissive) : new Color(0, 0, 0)}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A blank rectangle where a console should be tells the reader nothing. WebGL can be
 * missing, disabled, or simply out of contexts on a page that has been open a long
 * time — say so and let the rest of the page carry on.
 */
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <ConsoleUnavailable />;
    return this.props.children;
  }
}

function ConsoleUnavailable() {
  return (
    <div className="grid h-full w-full place-items-center px-6 text-center">
      <span className="label leading-relaxed">
        this browser could not draw the console
        <br />
        the desk still works
      </span>
    </div>
  );
}

/** Does this browser actually have a WebGL context to give us? */
function useWebGL() {
  const [ok] = useState(() => {
    if (typeof document === "undefined") return true; // decided on the client
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") ?? c.getContext("webgl");
      // Release it immediately; contexts are a scarce per-page resource.
      (gl?.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null)?.loseContext?.();
      return Boolean(gl);
    } catch {
      return false;
    }
  });
  return ok;
}

/**
 * Make sure the canvas ever gets measured.
 *
 * react-three-fiber sizes its canvas from a ResizeObserver, and Chrome does not deliver
 * ResizeObserver callbacks to a hidden tab — nor does it deliver the missed one when
 * the tab becomes visible, because by then the element's size has not *changed*. A page
 * opened in a background tab (cmd-click, a restored session, a link opened to read
 * later) therefore mounts the canvas at its 300x150 default and leaves it there: the
 * hero is permanently blank, with no error anywhere, and the only thing that fixes it is
 * the user resizing their window.
 *
 * So: after mount, and again whenever the document becomes visible, compare the canvas
 * to the box it is supposed to fill and dispatch a resize if they disagree.
 * react-use-measure listens for that, and re-measures. It is a nudge rather than a
 * reimplementation — the library still owns the sizing.
 */
function useEnsureMeasured(wrap: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const check = () => {
      const el = wrap.current;
      const canvas = el?.querySelector("canvas");
      if (!el || !canvas) return;
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      if (Math.abs(canvas.clientWidth - box.width) > 1) {
        window.dispatchEvent(new Event("resize"));
      }
    };

    // After the first paint, and once more a beat later for a slow hydration.
    const raf = requestAnimationFrame(check);
    const timer = setTimeout(check, 400);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [wrap]);
}

export function Console3D({ spin = true }: { spin?: boolean }) {
  const webglAvailable = useWebGL();
  const [contextLost, setContextLost] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEnsureMeasured(wrap);

  /** True once React has begun tearing this down, so teardown noise can be told apart. */
  const unmounting = useRef(false);
  useEffect(() => {
    unmounting.current = false;
    return () => {
      unmounting.current = true;
    };
  }, []);

  if (!webglAvailable || contextLost) return <ConsoleUnavailable />;

  return (
    <CanvasBoundary>
    <div ref={wrap} className="h-full w-full">
    <Canvas
      // A GPU reset, a backgrounded tab, or a page that has been open long enough to
      // exhaust the browser's context budget all take the canvas away without throwing.
      // Without this the hero silently becomes an empty rectangle.
      onCreated={({ gl }) => {
        /**
         * Handle context loss ourselves, and keep teardown quiet.
         *
         * Three attaches its own listener and logs "WebGLRenderer: Context Lost" — which
         * is worth having for a real loss and is pure noise on unmount, because
         * navigating away destroys the canvas and the browser fires the event every
         * time. Listening in the capture phase lets us decide: during teardown, stop it
         * before Three sees it; otherwise let it through and show the reader that the
         * console cannot be drawn.
         */
        gl.domElement.addEventListener(
          "webglcontextlost",
          (e) => {
            if (unmounting.current) {
              e.stopImmediatePropagation();
              return;
            }
            e.preventDefault();
            setContextLost(true);
          },
          { capture: true },
        );
      }}
      camera={{ position: [0, 0.02, 4.2], fov: 40 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ width: "100%", height: "100%" }}
    >
      <ambientLight intensity={0.5} />

      {/* Key light, warm and high from the front-right, the way a desk lamp sits. */}
      <directionalLight position={[3.5, 5, 3]} intensity={2.6} color="#fff4d6" />

      {/* Cool rim from behind-left to separate the chassis from a near-black page. */}
      <directionalLight position={[-3, 2, -2.5]} intensity={0.9} color="#9fb4d0" />

      {/* Screen spill, kept well off the glass — parked close it reads as a lens flare
          sitting on the display rather than light coming off it. */}
      <pointLight position={[0, 0.55, 2.1]} intensity={0.22} color="#ff9f0a" distance={5} />

      <ConsoleModel spin={spin} />
    </Canvas>
    </div>
    </CanvasBoundary>
  );
}
