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
        <img src="offbook.png" alt="OffBook" style={{ width: 320, height: 'auto', display: 'block' }} />
      </div>
    </div>
  )
}
