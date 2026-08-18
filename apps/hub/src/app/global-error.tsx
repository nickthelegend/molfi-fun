"use client";

/**
 * The last resort, for when the root layout itself throws.
 *
 * At this point the app's own html and body never rendered, so this has to supply them, and
 * it cannot rely on the stylesheet having loaded either. Everything here is inline for that
 * reason. It should never be seen, and if it is, it needs to work with nothing.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "#fff",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 460, padding: 24 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#6b6b6b" }}>molfi.fun</p>
          <h1 style={{ margin: "12px 0 0", fontSize: 28, fontWeight: 600 }}>
            The site failed to start
          </h1>
          <p style={{ marginTop: 12, color: "#9b9b9b", lineHeight: 1.6 }}>
            This is the outermost error handler, so the failure happened before any page was
            reached. Reloading is the only useful action from here.
          </p>
          {error.digest && (
            <p style={{ marginTop: 16, fontSize: 12, color: "#6b6b6b", fontFamily: "ui-monospace, monospace" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              padding: "10px 16px",
              borderRadius: 8,
              border: 0,
              background: "#fff",
              color: "#000",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
