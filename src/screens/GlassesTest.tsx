import { useEffect, useState } from 'react'
import type { Nav } from '../App'
import { BackButton, Mocky } from '../components/ui'
import { showOnGlasses } from '../glasses/bridge'
import { glassesTestCases } from '../glasses/texts'
import { imuDebug, recalibrateTilt, TILT, watchImu, watchTilt, type ImuSample, type Side } from '../glasses/tilt'
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
            <span style={{ fontSize: 16, lineHeight: '22px', whiteSpace: 'pre-line' }}>{current.view.text}</span>
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

      {glasses.available && <ImuReadout />}

      <div className="spacer" />

      <section className="row" style={{ gap: 12, paddingTop: 24 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => step(-1)}>Previous</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => step(1)}>Next</button>
      </section>
    </main>
  )
}

// Live IMU values and the tilt the detector sees, for tuning TILT in src/glasses/tilt.ts.
function ImuReadout() {
  const [sample, setSample] = useState<ImuSample | null>(null)
  const [lean, setLean] = useState<{ side: Side | null; progress: number }>({ side: null, progress: 0 })
  const [chosen, setChosen] = useState<Side | null>(null)

  useEffect(() => {
    const stops = [
      watchImu(setSample),
      watchTilt({
        onLean: (side, progress) => setLean({ side, progress }),
        onChoose: (side) => setChosen(side),
      }),
    ]
    return () => stops.forEach((stop) => stop.then((fn) => fn()))
  }, [])

  // imuDebug is a plain object updated by the event handler; poll it for display.
  const [debug, setDebug] = useState({ ...imuDebug })
  useEffect(() => {
    const timer = setInterval(() => setDebug({ ...imuDebug }), 500)
    return () => clearInterval(timer)
  }, [])

  const format = (n?: number) => (n == null ? '--' : n.toFixed(2))

  return (
    <section className="stack" style={{ gap: 8, paddingTop: 24 }}>
      <h2 className="eyebrow">Head tilt sensor</h2>
      <div className="row" style={{ gap: 8 }}>
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis} className="chip" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, borderColor: axis === TILT.axis ? 'var(--sky)' : undefined }}>
            <span className="small" style={{ fontWeight: 700 }}>{axis.toUpperCase()}</span>
            <span className="display" style={{ fontSize: 18 }}>{format(sample?.[axis])}</span>
          </div>
        ))}
      </div>
      <p className="small">
        {lean.side ? `Leaning ${lean.side} · ${Math.round(lean.progress * 100)}%` : 'Centered'}
        {chosen && ` · last choice: ${chosen}`}
      </p>
      <button className="pill" style={{ alignSelf: 'flex-start' }} onClick={() => { recalibrateTilt(); setChosen(null) }}>
        Recalibrate (hold head straight)
      </button>
      <p className="small">
        Using {TILT.axis.toUpperCase()} axis, threshold {TILT.threshold}, mode "{TILT.mode}". Tilt your head and watch which value moves.
      </p>
      <p className="small" style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
        imuControl: {String(debug.controlResult)} · events: {debug.events} · imu events: {debug.imuEvents}
        <br />
        last: {debug.lastEvent || '(none)'}
      </p>
    </section>
  )
}
