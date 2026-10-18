import { useEffect } from 'react'
import type { Nav } from '../App'
import type { Finding } from '../api/types'
import { HeartChart } from '../components/HeartChart'
import { BackButton, Mocky } from '../components/ui'
import { showOnGlasses } from '../glasses/bridge'
import { useGlassesInput } from '../glasses/input'
import { glassesTexts } from '../glasses/texts'
import { FindingRow, severityColor, severityTag } from './Results'
import { formatMs, useSessionReport, type SessionReport } from './useSessionReport'

// Context shown around a finding, before and after it.
const CONTEXT_MS = 5000

function momentContext({ segments, detail }: SessionReport, finding: Finding) {
  const from = Math.max(0, finding.start_ms - CONTEXT_MS)
  const to = finding.end_ms + CONTEXT_MS
  const said = segments.filter((s) => s.end_ms >= from && s.start_ms <= to)
  // The question on screen when this happened.
  const question = [...detail.questions]
    .filter((q) => q.asked_at_ms != null && q.asked_at_ms <= finding.start_ms)
    .sort((a, b) => b.asked_at_ms! - a.asked_at_ms!)[0]
  return { from, to, said, question }
}

// Behavioral findings carry a note; system design ones an observation and a recommendation.
function findingNote(finding: Finding) {
  const { note, observation, recommendation } = finding.details as { note?: string; observation?: string; recommendation?: string }
  return note ?? [observation, recommendation].filter(Boolean).join(' ')
}

// The moment as plain text for the glasses.
function momentText(data: SessionReport, finding: Finding, hasNext: boolean) {
  const { said, question } = momentContext(data, finding)
  return [
    `${finding.title} (${finding.severity})`,
    findingNote(finding),
    question ? `During: ${question.text}` : '',
    said.length ? `You said:\n${said.map((s) => `${formatMs(s.start_ms)} ${s.text}`).join('\n')}` : '',
    hasNext ? 'Press for the next moment.' : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

// One finding from the report: what Mocky noticed, what you said around that
// time, and your heart rate then.
export function Moment({ sessionId, findingId, nav }: { sessionId: string; findingId: string; nav: Nav }) {
  const { state } = useSessionReport(sessionId)
  const back = () => nav({ name: 'results', sessionId })

  const finding = state.kind === 'done' ? (state.data.report.findings.find((f) => f.id === findingId) ?? state.data.report.findings[0]) : undefined
  const findings = state.kind === 'done' ? state.data.report.findings : []
  const nextFinding = finding ? findings[(findings.indexOf(finding) + 1) % findings.length] : undefined

  // Glasses: the moment as scrollable text; press for the next one, double press back.
  useEffect(() => {
    if (state.kind !== 'done' || !finding) return
    showOnGlasses(glassesTexts.readBack(`Moment ${formatMs(finding.start_ms)}`, momentText(state.data, finding, findings.length > 1)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, finding?.id])

  useGlassesInput((input) => {
    if (input.kind === 'double') back()
    else if (input.kind === 'press' && nextFinding && nextFinding !== finding) nav({ name: 'moment', sessionId, findingId: nextFinding.id })
  })

  if (state.kind !== 'done' || !finding) {
    return (
      <main className="screen center" style={{ justifyContent: 'center', gap: 12 }}>
        <Mocky size={96} />
        {state.kind === 'error' && <p className="error">{state.message}</p>}
        <button className="btn ghost" onClick={back}>Back to results</button>
      </main>
    )
  }

  const { heart } = state.data

  const { from, to, said, question } = momentContext(state.data, finding)
  const inside = (s: { start_ms: number; end_ms: number }) => s.end_ms >= finding.start_ms && s.start_ms <= finding.end_ms
  const others = findings.filter((f) => f.id !== finding.id)

  return (
    <main className="screen">
      <header className="row" style={{ gap: 12, paddingBottom: 14 }}>
        <BackButton onClick={back} />
        <h1 className="h2" style={{ flex: 1 }}>Moment</h1>
      </header>

      <section className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className={severityTag[finding.severity]} style={{ fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>{finding.severity}</span>
          <span className="small">
            {formatMs(finding.start_ms)}–{formatMs(finding.end_ms)} · {finding.category.replace(/_/g, ' ')}
          </span>
        </div>
        <h2 className="h1" style={{ fontSize: 26, lineHeight: '32px' }}>{finding.title}</h2>
        {question && <p className="muted">During: "{question.text}"</p>}
      </section>

      {findingNote(finding) && (
        <section className="row" style={{ alignItems: 'flex-start', gap: 10, paddingTop: 18 }}>
          <Mocky size={52} style={{ flexShrink: 0 }} />
          <div className="coach">
            <span className="eyebrow" style={{ color: 'var(--sky)' }}>Mocky noticed</span>
            <p style={{ fontWeight: 600, fontSize: 15, lineHeight: '21px' }}>{findingNote(finding)}</p>
          </div>
        </section>
      )}

      <section className="stack" style={{ gap: 8, paddingTop: 20 }}>
        <h2 className="eyebrow">What you said</h2>
        {said.length === 0 ? (
          <p className="small">No transcript for this part of the interview.</p>
        ) : (
          said.map((segment) => (
            <p
              key={segment.start_ms}
              style={{
                fontSize: 16,
                lineHeight: '24px',
                padding: '6px 10px',
                borderRadius: 10,
                background: inside(segment) ? `${severityColor[finding.severity]}22` : 'transparent',
                borderLeft: `3px solid ${inside(segment) ? severityColor[finding.severity] : 'var(--line)'}`,
              }}
            >
              <span className="small" style={{ fontWeight: 700, marginRight: 8 }}>{formatMs(segment.start_ms)}</span>
              {segment.text}
            </p>
          ))
        )}
      </section>

      <section className="card stack" style={{ gap: 8, marginTop: 20 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Heart rate around this moment</span>
        <HeartChart heart={heart} from={from} to={to} bands={[{ start_ms: finding.start_ms, end_ms: finding.end_ms, color: severityColor[finding.severity] }]} height={90} />
      </section>

      {others.length > 0 && (
        <section className="stack" style={{ paddingTop: 22 }}>
          <h2 className="eyebrow" style={{ paddingBottom: 4 }}>Other moments</h2>
          {others.map((other) => (
            <FindingRow key={other.id} finding={other} onClick={() => nav({ name: 'moment', sessionId, findingId: other.id })} />
          ))}
        </section>
      )}
    </main>
  )
}
