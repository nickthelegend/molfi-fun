"use client";

import { usePrefs, type Prefs } from "@/lib/usePrefs";

/**
 * The cabinet's colourway.
 *
 * The console is generated geometry and CSS rather than artwork, which means a theme is
 * a handful of numbers rather than a second set of assets. Each one keeps the same
 * black screen and amber readout — the parts that carry meaning — and repaints only the
 * shell, so no theme can make a price harder to read.
 */
const THEMES: {
  id: Prefs["theme"];
  name: string;
  note: string;
  shell: string;
  shellDark: string;
  key: string;
}[] = [
  {
    id: "cream",
    name: "Cream",
    note: "The original. Warm plastic, amber phosphor.",
    shell: "#f7efc2",
    shellDark: "#e0d5a2",
    key: "#9b8cf0",
  },
  {
    id: "charcoal",
    name: "Charcoal",
    note: "Matte black body, same screen.",
    shell: "#3a3a3c",
    shellDark: "#2a2a2c",
    key: "#8f7fe8",
  },
  {
    id: "mint",
    name: "Mint",
    note: "Pale green, the way lab equipment used to look.",
    shell: "#cfe8d5",
    shellDark: "#b3d2ba",
    key: "#7fa8f0",
  },
  {
    id: "rose",
    name: "Rose",
    note: "Dusty pink shell, lilac keys.",
    shell: "#f0d3d8",
    shellDark: "#d9b6bd",
    key: "#a88cf0",
  },
];

export function Customize() {
  const { prefs, set } = usePrefs();

  return (
    <div className="pb-6">
      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((t) => {
          const active = prefs.theme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => set("theme", t.id)}
              aria-pressed={active}
              className={`rounded-2xl p-3 text-left transition-[background-color,box-shadow] duration-200 ease-out ${
                active ? "bg-[#1c1a14] ring-2 ring-amber" : "bg-[#141414] hover:bg-[#1a1a1a]"
              }`}
            >
              {/* A small console, painted in the theme. */}
              <div
                className="relative mx-auto h-[86px] w-[62px] rounded-[10px] p-[5px]"
                style={{ background: t.shell, boxShadow: `inset 0 -3px 0 ${t.shellDark}` }}
              >
                <div className="h-[46px] w-full rounded-[4px] bg-[#060606]">
                  <div className="mt-[18px] flex justify-center gap-[2px]">
                    {[3, 5, 4].map((h, i) => (
                      <span
                        key={i}
                        className="w-[3px] rounded-[1px] bg-amber"
                        style={{ height: h * 2 }}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-[6px] flex gap-[3px]">
                  <span className="h-[10px] flex-1 rounded-[2px]" style={{ background: t.key }} />
                  <span className="h-[10px] flex-1 rounded-[2px]" style={{ background: t.key }} />
                  <span className="h-[10px] w-[10px] rounded-[2px] bg-[#f26522]" />
                </div>
              </div>

              <div className="mt-2.5 text-[13px] font-semibold text-white">{t.name}</div>
              <p className="mt-0.5 text-[11px] leading-snug text-white/40">{t.note}</p>
            </button>
          );
        })}
      </div>

      <p className="mt-4 px-1 text-[11px] leading-relaxed text-white/35">
        The screen and the readout never change colour. Those carry the price, and a
        theme that made them harder to read would be a worse console, not a
        personalised one.
      </p>
    </div>
  );
}
