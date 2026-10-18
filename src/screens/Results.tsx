import type { Nav } from '../App'
import { icons, Meter, Mocky } from '../components/ui'
import { useResult } from './useResult'

export function Results({ resultId, nav }: { resultId: string; nav: Nav }) {
  const { result, error } = useResult(resultId)

  if (!result) {
    return (
      <main className="screen stripes center" style={{ justifyContent: 'center', gap: 12 }}>
        <Mocky size={96} />
        <p className={error ? 'error' : 'muted'}>{error || 'Loading your results…'}</p>
        {error && <button className="btn ghost" onClick={() => nav({ name: 'home' })}>Back home</button>}
      </main>
    )
  }

  const weakClipCount = result.clips.length

  return (
    <main className="screen">
      <section className="score-hero stack" style={{ gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="eyebrow" style={{ color: 'var(--sky)' }}>
            {result.companyName} mock · {Math.round(result.durationSeconds / 60)} min
          </span>
          <button className="link" style={{ fontSize: 14 }} onClick={() => nav({ name: 'home' })}>Done</button>
        </div>
        <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
          <span className="display" style={{ fontWeight: 700, fontSize: 104, lineHeight: '96px', letterSpacing: '-0.03em' }}>{result.score}</span>
          <span className="stack" style={{ gap: 2, paddingBottom: 8 }}>
            <span className="display" style={{ fontWeight: 500, fontSize: 22, color: 'var(--ink-3)' }}>/ 100</span>
            {result.scoreDelta != null && (
              <span style={{ fontWeight: 700, fontSize: 13, color: result.scoreDelta >= 0 ? 'var(--good)' : 'var(--bad-ink)' }}>
                {result.scoreDelta >= 0 ? '+' : ''}{result.scoreDelta} since last mock
              </span>
            )}
          </span>
        </div>
        <p style={{ fontSize: 16, lineHeight: '23px', maxWidth: 240 }}>{result.headline}</p>
        <Mocky size={112} className="in" style={{ position: 'absolute', right: 8, bottom: 6, transform: 'rotate(8deg)' }} />
      </section>

      <section className="stack" style={{ paddingTop: 22 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 6 }}>
          <h2 className="h2">Where you slipped</h2>
        </div>
        {result.signals.map((signal) => (
          <button
            key={signal.key}
            className="signal-row"
            disabled={signal.clipIds.length === 0}
            onClick={() => nav({ name: 'clips', resultId, clipId: signal.clipIds[0] })}
          >
            <span className="stack" style={{ flex: 1, gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{signal.label}</span>
              <span className="small">{signal.detail}</span>
            </span>
            <Meter severity={signal.severity} />
            <span className="play" style={{ visibility: signal.clipIds.length ? 'visible' : 'hidden' }}>{icons.play()}</span>
          </button>
        ))}
      </section>

      <section className="stack" style={{ gap: 12, paddingTop: 26 }}>
        <h2 className="h2">Mocky's read</h2>
        <div className="read" style={{ borderColor: 'var(--good)' }}>
          <span className="eyebrow" style={{ color: 'var(--good)' }}>What landed</span>
          <p style={{ fontSize: 15, lineHeight: '22px' }}>{result.strengths}</p>
        </div>
        <div className="read" style={{ borderColor: 'var(--bad)' }}>
          <span className="eyebrow" style={{ color: 'var(--bad)' }}>What to fix</span>
          <p style={{ fontSize: 15, lineHeight: '22px' }}>{result.weaknesses}</p>
        </div>
      </section>

      <section className="stack" style={{ gap: 10, paddingTop: 24 }}>
        {weakClipCount > 0 && (
          <button className="btn" onClick={() => nav({ name: 'clips', resultId })}>
            {icons.play('#fff')}
            Watch your weak clips
          </button>
        )}
        <button className="btn ghost" onClick={() => nav({ name: 'home' })}>Retry with a new company</button>
        <p className="row small" style={{ justifyContent: 'center', gap: 6, paddingTop: 4 }}>
          {icons.check('#2FA866', 14)}
          Saved to My mocks in your account
        </p>
      </section>
    </main>
  )
}
