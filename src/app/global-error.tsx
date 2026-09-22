'use client';

/**
 * Last line of defence. Without a boundary, one thrown render takes the whole
 * till to a blank white page in the middle of service, with no indication that
 * the day's sales are still sitting safely in IndexedDB.
 *
 * This replaces the root layout when it fires, so it brings its own markup and
 * its own colours — no stylesheet, no store, nothing that could fail twice.
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
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f0ede9',
          color: '#111111',
          fontFamily: 'ui-sans-serif, -apple-system, system-ui, "Segoe UI", sans-serif',
          padding: 24,
        }}
      >
        <main style={{ maxWidth: 420, textAlign: 'center' }}>
          <p
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: '0 0 6px',
            }}
          >
            KRAM<span style={{ color: '#ff5c1a' }}>GEN</span>
          </p>
          <h1 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>
            Something broke on this screen
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#444444', margin: '0 0 18px' }}>
            Your sales are still saved on this device. Nothing has been lost. Try again,
            and if it keeps happening, reload — open orders survive both.
          </p>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                height: 44,
                padding: '0 20px',
                borderRadius: 6,
                border: 'none',
                background: '#ff5c1a',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: 44,
                padding: '0 20px',
                borderRadius: 6,
                border: '1px solid #e5e2dd',
                background: '#ffffff',
                color: '#111111',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>

          {/* Whoever gets called about this needs something to go on. */}
          <p
            style={{
              marginTop: 18,
              fontSize: 11,
              lineHeight: 1.5,
              color: '#888888',
              fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, monospace',
              wordBreak: 'break-word',
            }}
          >
            {error.message}
            {error.digest ? ` (${error.digest})` : ''}
          </p>
        </main>
      </body>
    </html>
  );
}
