import { useEffect, useState } from 'react'

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [ready, setReady] = useState(false)
  const [out, setOut] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setReady(true), 60)    // trigger enter animation
    const t2 = setTimeout(() => setOut(true), 1800)    // start fade-out
    const t3 = setTimeout(onDone, 2350)                // unmount after fade finishes
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [onDone])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--color-stage-bg)]"
      style={{ transition: 'opacity 500ms ease', opacity: out ? 0 : 1 }}
    >
      <div style={{
        transition: 'transform 700ms cubic-bezier(0.34,1.56,0.64,1), opacity 600ms ease',
        transform: ready ? 'scale(1)' : 'scale(0.35)',
        opacity: ready ? 1 : 0,
      }}>
        <AppIconInline size={96} />
      </div>

      <h1
        className="text-3xl font-bold text-[var(--color-stage-text)] mt-6"
        style={{
          transition: 'opacity 600ms ease 180ms, transform 600ms ease 180ms',
          opacity: ready ? 1 : 0,
          transform: ready ? 'translateY(0)' : 'translateY(10px)',
        }}
      >
        Rehearsal
      </h1>

      <p
        className="text-sm text-[var(--color-stage-muted)] mt-2"
        style={{
          transition: 'opacity 600ms ease 320ms, transform 600ms ease 320ms',
          opacity: ready ? 1 : 0,
          transform: ready ? 'translateY(0)' : 'translateY(8px)',
        }}
      >
        Learn your lines
      </p>
    </div>
  )
}

function AppIconInline({ size }: { size: number }) {
  const r = (size * 96) / 512  // corner radius proportional to SVG
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size} height={size}
      viewBox="0 0 512 512"
      style={{ borderRadius: r, display: 'block' }}
    >
      <defs>
        <clipPath id="sp-cl"><rect width="256" height="512"/></clipPath>
        <clipPath id="sp-cr"><rect x="256" width="256" height="512"/></clipPath>
        <radialGradient id="sp-bg" cx="50%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#2a2660"/>
          <stop offset="100%" stopColor="#0c0b16"/>
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="96" fill="url(#sp-bg)"/>
      <ellipse cx="256" cy="272" rx="174" ry="190" fill="#f59e0b" clipPath="url(#sp-cl)"/>
      <ellipse cx="256" cy="272" rx="174" ry="190" fill="#7c3aed" clipPath="url(#sp-cr)"/>
      <rect x="252" y="84" width="8" height="376" rx="4" fill="#0c0b16"/>
      <ellipse cx="188" cy="224" rx="25" ry="28" fill="#1e1b4b" clipPath="url(#sp-cl)"/>
      <ellipse cx="324" cy="224" rx="25" ry="28" fill="#ddd6fe" clipPath="url(#sp-cr)"/>
      <path d="M176 312 Q218 368 255 312" stroke="#1e1b4b" strokeWidth="16" fill="none" strokeLinecap="round" clipPath="url(#sp-cl)"/>
      <path d="M257 344 Q298 290 340 344" stroke="#ddd6fe" strokeWidth="16" fill="none" strokeLinecap="round" clipPath="url(#sp-cr)"/>
    </svg>
  )
}
