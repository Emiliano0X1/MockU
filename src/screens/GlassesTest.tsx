import { useEffect, useState } from 'react'
import type { Nav } from '../App'
import { BackButton, Mocky } from '../components/ui'
import { showOnGlasses } from '../glasses/bridge'
import { glassesTestCases } from '../glasses/texts'
import { useGlassesStatus } from '../glasses/useGlassesStatus'

// Steps through every view the glasses can show and sends each one to the glasses.
export function GlassesTest({ nav }: { nav: Nav }) {
  const [index, setIndex] = useState(0)
  const [sent, setSent] = useState<boolean | null>(null)
  const glasses = useGlassesStatus()
  const current = glassesTestCases[index]!

  useEffect(() => {
    setSent(null)
    showOnGlasses(current.view).then(setSent)
  }, [current])

  const step = (delta: number) => setIndex((i) => (i + delta + glassesTestCases.length) % glassesTestCases.length)

  return (
    <main className="screen">
      <header className="row" style={{ gap: 12 }}>
        <BackButton onClick={() => nav({ name: 'home' })} />
        <h1 className="h2" style={{ flex: 1 }}>Glasses texts</h1>
        <span className="small" style={{ fontWeight: 700 }}>{index + 1} / {glassesTestCases.length}</span>
      </header>

      <section className="stack" style={{ gap: 10, paddingTop: 24 }}>
        <span className="eyebrow">{current.name}</span>
        <div className="lens" aria-label="Glasses preview">
          {current.view.mocky && <Mocky size={0} style={{ width: '22%', height: 'auto' }} />}
          <div className="stack" style={{ gap: 6, minWidth: 0 }}>
            {current.view.label && <span style={{ fontSize: 13, opacity: 0.6 }}>{current.view.label}</span>}
            <span style={{ fontSize: 16, lineHeight: '22px' }}>{current.view.text}</span>
          </div>
        </div>
        <p className="small">
          {!glasses.available
            ? 'Preview only. Open MockU in the Even app to send these to your glasses.'
            : sent === null
              ? 'Sending to your glasses…'
              : sent
                ? 'Showing on your glasses now.'
                : "Couldn't reach your glasses."}
        </p>
      </section>

      <div className="spacer" />

      <section className="row" style={{ gap: 12, paddingTop: 24 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => step(-1)}>Previous</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => step(1)}>Next</button>
      </section>
    </main>
  )
}
