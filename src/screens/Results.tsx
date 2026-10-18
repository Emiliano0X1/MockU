import { useEffect, useState } from 'react'
import type { Nav } from '../App'
import { api, errorMessage } from '../api/client'
import type { Finding, Severity } from '../api/types'
import { DiagramView } from '../components/DiagramView'
import { HeartChart } from '../components/HeartChart'
import { icons, Mocky } from '../components/ui'
import { showOnGlasses } from '../glasses/bridge'
import { useGlassesInput } from '../glasses/input'
import { glassesTexts } from '../glasses/texts'
import { forgetSessionReport, formatMs, useSessionReport, type SessionReport } from './useSessionReport'

export const severityTag: Record<Severity, string> = { high: 'tag bad', medium: 'tag warn', low: 'tag good' }
export const severityColor: Record<Severity, string> = { high: '#E5484D', medium: '#F5A524', low: '#2FA866' }

export function Results({ sessionId, nav }: { sessionId: string; nav: Nav }) {
  const { state, retry, reprocess } = useSessionReport(sessionId)
  // In the glasses: a menu (summary, each moment, back home) or the summary text.
  const [glassesPage, setGlassesPage] = useState<'menu' | 'summary'>('menu')
  const data = state.kind === 'done' ? state.data : null
  const findings = data?.report.findings ?? []

  useEffect(() => {
    if (state.kind === 'loading' || state.kind === 'processing') {
      showOnGlasses(glassesTexts.reviewing())
    } else if (!data) {
      showOnGlasses({ mocky: true, label: 'Results · 2x press home', text: 'Something went wrong. Check your phone.' })
    } else if (glassesPage === 'summary') {
      showOnGlasses(glassesTexts.readBack('Summary', summaryText(data)))
    } else {
      showOnGlasses(glassesTexts.resultsMenu(data.report.overall_score, ['Summary', ...findings.map(findingItem), 'Back home']))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, data, glassesPage])

  useGlassesInput((input) => {
    if (glassesPage === 'summary' && data) {
      if (input.kind === 'double') setGlassesPage('menu')
      return
    }
    if (input.kind === 'double') return nav({ name: 'home' })
    if (input.kind !== 'select' || !data) return
    if (input.index === 0) setGlassesPage('summary')
    else if (input.index <= findings.length) nav({ name: 'moment', sessionId, findingId: findings[input.index - 1]!.id })
    else nav({ name: 'home' })
  })

  if (state.kind !== 'done') {
    const message = {
      loading: 'Loading your results…',
      processing: 'Mocky is reviewing your answers. This takes a moment.',
      missing: "This interview ended before its recording was saved, so there's nothing to review.",
      unsubmitted: 'Mocky drew this design, but it was never submitted for grading.',
      cancelled: 'This design challenge was cancelled, so there is no grade.',
      failed: 'Mocky ran into a problem reviewing this interview.',
      error: state.kind === 'error' ? state.message : '',
    }[state.kind]
    return (
      <main className="screen stripes center" style={{ justifyContent: 'center', gap: 12 }}>
        <Mocky size={96} className={state.kind === 'processing' ? 'in' : ''} />
        <p className={state.kind === 'error' || state.kind === 'failed' ? 'error' : 'muted'} style={{ textAlign: 'center' }}>{message}</p>
        {state.kind === 'failed' && <button className="btn" onClick={reprocess}>Try the review again</button>}
        {state.kind === 'error' && <button className="btn" onClick={retry}>Try again</button>}
        {state.kind !== 'loading' && state.kind !== 'processing' && (
          <button className="btn ghost" onClick={() => nav({ name: 'home' })}>Back home</button>
        )}
      </main>
    )
  }

  return <ReportView data={state.data} nav={nav} />
}

function ReportView({ data, nav }: { data: SessionReport; nav: Nav }) {
  const { detail, report, heart, tips, companyName } = data
  const { summary, findings } = report
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const minutes = detail.ended_at ? Math.max(1, Math.round((Date.parse(detail.ended_at) - Date.parse(detail.started_at)) / 60000)) : null
  const design = detail.mode === 'system_design'
  const accent = design ? 'var(--aurora)' : 'var(--sky)'
  const subscores = subscoresOf(summary)

  const remove = async () => {
    try {
      await api.deleteSession(detail.id)
      forgetSessionReport(detail.id)
      nav({ name: 'history' })
    } catch (err) {
      setConfirmDelete(false)
      setDeleteError(errorMessage(err, "Couldn't delete this mock."))
    }
  }

  return (
    <main className="screen">
      <section className="score-hero stack" style={{ gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="eyebrow" style={{ color: accent }}>
            {companyName} · {design ? 'System design' : 'Behavioral'}{minutes ? ` · ${minutes} min` : ''}
          </span>
          <button className="link" style={{ fontSize: 14 }} onClick={() => nav({ name: 'home' })}>Done</button>
        </div>
        <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
          <span className="display" style={{ fontWeight: 700, fontSize: 104, lineHeight: '96px', letterSpacing: '-0.03em' }}>
            {report.overall_score ?? '--'}
          </span>
          <span className="display" style={{ fontWeight: 500, fontSize: 22, color: 'var(--ink-3)', paddingBottom: 8 }}>/ 100</span>
        </div>
        <p style={{ fontSize: 16, lineHeight: '23px', maxWidth: 240 }}>{summary.overview ?? headline(report.overall_score)}</p>
        <Mocky size={112} className="in" style={{ position: 'absolute', right: 8, bottom: 6, transform: 'rotate(8deg)' }} />
      </section>

      {subscores.length > 0 && (
        <section className="stack" style={{ gap: 10, paddingTop: 22 }}>
          {subscores.map((s) => (
            <div key={s.label} className="subscore">
              <span style={{ fontWeight: 700, fontSize: 14, width: 120 }}>{s.label}</span>
              <span className="subscore-bar"><span style={{ width: `${Math.max(0, Math.min(100, s.value))}%`, background: accent }} /></span>
              <span className="display" style={{ fontSize: 16, width: 32, textAlign: 'right' }}>{s.value}</span>
            </div>
          ))}
        </section>
      )}

      {design && data.graph && (
        <section className="stack" style={{ gap: 10, paddingTop: 24 }}>
          <h2 className="h2">Your design</h2>
          <div className="card">
            <DiagramView graph={data.graph} />
          </div>
        </section>
      )}

      {findings.length > 0 && (
        <section className="stack" style={{ paddingTop: 24 }}>
          <h2 className="h2" style={{ paddingBottom: 6 }}>{design ? 'What to improve' : 'Moments to review'}</h2>
          {findings.map((finding) => (
            <FindingRow key={finding.id} finding={finding} onClick={() => nav({ name: 'moment', sessionId: detail.id, findingId: finding.id })} />
          ))}
        </section>
      )}

      <section className="card stack" style={{ gap: 8, marginTop: 24 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Heart rate</span>
          {heart.stats.count > 0 && (
            <span className="small" style={{ fontSize: 12 }}>
              avg {Math.round(heart.stats.avg_bpm ?? 0)} · peak {heart.stats.max_bpm}
              {heart.stats.baseline_bpm != null && ` · resting ${heart.stats.baseline_bpm}`}
            </span>
          )}
        </div>
        <HeartChart heart={heart} bands={findings.map((f) => ({ start_ms: f.start_ms, end_ms: f.end_ms, color: severityColor[f.severity] }))} />
      </section>

      {(summary.key_strengths?.length || summary.areas_for_growth?.length) && (
        <section className="stack" style={{ gap: 12, paddingTop: 26 }}>
          <h2 className="h2">Mocky's read</h2>
          {!!summary.key_strengths?.length && (
            <div className="read" style={{ borderColor: 'var(--good)' }}>
              <span className="eyebrow" style={{ color: 'var(--good)' }}>What landed</span>
              <BulletList items={summary.key_strengths} />
            </div>
          )}
          {!!summary.areas_for_growth?.length && (
            <div className="read" style={{ borderColor: 'var(--bad)' }}>
              <span className="eyebrow" style={{ color: 'var(--bad)' }}>What to fix</span>
              <BulletList items={summary.areas_for_growth} />
            </div>
          )}
        </section>
      )}

      {tips.length > 0 && (
        <section className="stack" style={{ gap: 8, paddingTop: 24 }}>
          <h2 className="eyebrow">Tips Mocky gave you live</h2>
          {tips.map((tip) => (
            <div key={tip.id} className="row" style={{ gap: 10 }}>
              <span className="small" style={{ width: 40, flexShrink: 0, fontWeight: 700 }}>{formatMs(tip.t_ms)}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{tip.text}</span>
              {tip.bpm_at_trigger != null && <span className="small">{tip.bpm_at_trigger} bpm</span>}
            </div>
          ))}
        </section>
      )}

      <section className="stack" style={{ gap: 10, paddingTop: 24 }}>
        <button className="btn" style={{ background: accent }} onClick={() => nav({ name: 'home' })}>Retry with a new company</button>
        <p className="row small" style={{ justifyContent: 'center', gap: 6, paddingTop: 4 }}>
          {icons.check('#2FA866', 14)}
          Saved to My mocks
        </p>
        {deleteError && <p className="error" role="alert">{deleteError}</p>}
        <button className="link" style={{ color: 'var(--bad-ink)', fontSize: 14, alignSelf: 'center' }} onClick={() => setConfirmDelete(true)}>
          Delete this mock
        </button>
      </section>

      {confirmDelete && (
        <div className="scrim" onClick={() => setConfirmDelete(false)}>
          <div className="sheet rise stack" style={{ gap: 12, paddingTop: 24 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="h2">Delete this mock?</h2>
            <p className="muted">The recording, transcript and report are removed from the server. This can't be undone.</p>
            <button className="btn" style={{ background: 'var(--bad)' }} onClick={remove}>Delete</button>
            <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </div>
        </div>
      )}
    </main>
  )
}

export function FindingRow({ finding, onClick }: { finding: Finding; onClick: () => void }) {
  return (
    <button className="list-row" onClick={onClick}>
      <span className={severityTag[finding.severity]} style={{ width: 64, textAlign: 'center', fontSize: 12, fontWeight: 700, lineHeight: '20px', flexShrink: 0, textTransform: 'capitalize' }}>
        {finding.severity}
      </span>
      <span className="stack" style={{ flex: 1, gap: 2 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{finding.title}</span>
        <span className="small">
          at {formatMs(finding.start_ms)} · {finding.category.replace(/_/g, ' ')}
        </span>
      </span>
      {icons.chevron}
    </button>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((item) => (
        <li key={item} style={{ fontSize: 15, lineHeight: '22px' }}>{item}</li>
      ))}
    </ul>
  )
}

const severityShort: Record<Severity, string> = { high: 'HIGH', medium: 'MED', low: 'LOW' }

export function findingItem(finding: Finding) {
  return `[${severityShort[finding.severity]}] ${finding.title}`
}

// The results page as plain text for the glasses.
// Sub-scores present in the report: behavioral and system design use different ones.
function subscoresOf(summary: SessionReport['report']['summary']) {
  return [
    { label: 'Architecture', value: summary.architecture_score },
    { label: 'Scalability', value: summary.scalability_score },
    { label: 'Trade-offs', value: summary.tradeoffs_score },
    { label: 'Communication', value: summary.communication_score },
    { label: 'Technical depth', value: summary.technical_depth_score },
    { label: 'Composure', value: summary.composure_score },
  ].filter((s): s is { label: string; value: number } => typeof s.value === 'number')
}

function summaryText({ report, tips }: SessionReport) {
  const { summary } = report
  return [
    `Score ${report.overall_score ?? '--'}/100`,
    summary.overview ?? headline(report.overall_score),
    subscoresOf(summary).map((s) => `${s.label}: ${s.value}`).join('\n'),
    summary.key_strengths?.length ? `What landed\n${summary.key_strengths.map((s) => `- ${s}`).join('\n')}` : '',
    summary.areas_for_growth?.length ? `What to fix\n${summary.areas_for_growth.map((s) => `- ${s}`).join('\n')}` : '',
    tips.length ? `Live tips\n${tips.map((t) => `- ${formatMs(t.t_ms)} ${t.text}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function headline(score: number | null) {
  if (score == null) return 'Here is how your interview went.'
  if (score >= 85) return 'Strong interview. Polish the moments below.'
  if (score >= 70) return 'Solid answers, with a few moments to work on.'
  return 'A few habits are holding you back. Start with the moments below.'
}
