"use client";


/**
 * The console body. Everything in molfi happens inside this chassis, on any screen size:
 * the device is the app, not a decoration around a web page.
 *
 * Three surfaces, nested, and the nesting is the point — chassis → recess → black glass,
 * radii 32 → 22 → 15. The glass used to sit straight on the body, which reads as a dark box
 * on a slightly less dark box; a bezel between them is most of what makes it hardware.
 *
 * The deck and the footer are passed in rather than composed here because their contents
 * differ between the paper desk and the live one, while the body they sit in must not.
 */
export function DeviceFrame({
  glass,
  deck,
  footer,
}: {
  glass: React.ReactNode;
  deck: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[460px] px-3 py-4">
      <div className="shell rounded-[32px] p-[10px]">
        {/* bezel → glass */}
        <div className="recess rounded-[22px] p-[9px]">{glass}</div>

        {deck}

        {footer}

        {/*
          * The volume rail is gone.
          *
          * It was a full-width slider across the bottom of the chassis — the widest control on
          * the device — spending the most prominent strip of hardware on the least important
          * setting. Sound is still mutable; the key moved into the footer row beside the other
          * keys, where it is one key among four rather than a bar the eye lands on first.
          */}
      </div>
    </div>
  );
}
