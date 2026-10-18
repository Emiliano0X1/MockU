import { useEffect, useState } from 'react'
import type { Nav } from '../App'
import { api, errorMessage } from '../api/client'
import type { SessionListItem, SessionStatus } from '../api/types'
import { BackButton, icons, Mocky } from '../components/ui'
import { showOnGlasses } from '../glasses/bridge'
import { useGlassesInput } from '../glasses/input'
import { glassesTexts } from '../glasses/texts'

const statusNames: Record<SessionStatus, string> = {
  recording: 'Not finished',
  processing: 'Mocky is reviewing',
  interpreting: 'Drawing diagram',
  awaiting_review: 'Diagram not submitted',
  grading: 'Mocky is grading',
  done: 'Done',
  failed: 'Review failed',
  cancelled: 'Cancelled',
}

export function History({ profileId, nav }: { profileId: string; nav: Nav }) {
  const [items, setItems] = useState<SessionListItem[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listSessions(profileId)
      .then((list) => setItems(list.items))
      .catch((err) => setError(errorMessage(err, "Couldn't load your mocks.")))
  }, [profileId])

  // Glasses: list of mocks, press opens one, double press goes home.
  useEffect(() => {
    if (error) showOnGlasses({ mocky: true, label: 'My mocks · 2x press home', text: "Couldn't load your mocks." })
    else if (!items) showOnGlasses({ mocky: true, label: 'My mocks', text: 'Loading…' })
    else if (items.length === 0) showOnGlasses(glassesTexts.historyEmpty())
    else
      showOnGlasses(
        glassesTexts.historyMenu(items.map((item) => `${item.overall_score ?? '--'}  ${item.company.name}  ${formatDate(item.started_at)}`)),
      )
  }, [items, error])

  useGlassesInput((input) => {
    if (input.kind === 'double') nav({ name: 'home' })
    else if (input.kind === 'select' && items?.[input.index]) nav({ name: 'results', sessionId: items[input.index]!.id })
  })

  // Newest first, as the server returns them; only finished, scored mocks count for the trend.
  const scored = (items ?? []).filter((item): item is SessionListItem & { overall_score: number } => item.overall_score != null)
  const latest = scored[0]
  const first = scored[scored.length - 1]

  return (
    <main className="screen">
      <header className="row" style={{ gap: 12 }}>
        <BackButton onClick={() => nav({ name: 'home' })} />
        <h1 className="h2" style={{ flex: 1 }}>Your mocks</h1>
      </header>

      {error && <p className="error" style={{ paddingTop: 20 }}>{error}</p>}
      {!items && !error && <p className="muted" style={{ paddingTop: 20 }}>Loading…</p>}
      {items && items.length === 0 && (
        <div className="stack center" style={{ gap: 10, paddingTop: 80 }}>
          <Mocky size={96} />
          <p className="muted">Your finished mocks will show up here.</p>
        </div>
      )}

      {latest && first && (
        <section className="stack" style={{ gap: 6, paddingTop: 18 }}>
          <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
            <span className="display" style={{ fontWeight: 700, fontSize: 56, lineHeight: '56px', letterSpacing: '-0.02em' }}>{latest.overall_score}</span>
            <span className="stack" style={{ paddingBottom: 6 }}>
              {scored.length > 1 && (
                <span style={{ fontWeight: 700, fontSize: 13, color: latest.overall_score >= first.overall_score ? 'var(--good)' : 'var(--bad-ink)' }}>
                  {latest.overall_score >= first.overall_score ? '+' : ''}{latest.overall_score - first.overall_score} since your first mock
                </span>
              )}
              <span className="small">Latest score</span>
            </span>
          </div>
          {scored.length > 1 && <Trend scores={[...scored].reverse().map((item) => item.overall_score)} />}
        </section>
      )}

      {items && items.length > 0 && (
        <section className="stack" style={{ paddingTop: 18 }}>
          <h2 className="eyebrow" style={{ paddingBottom: 4 }}>All mocks</h2>
          {items.map((item, i) => (
            <button key={item.id} className="list-row" onClick={() => nav({ name: 'results', sessionId: item.id })}>
              <span className={`score-badge ${i === 0 ? 'latest' : ''}`}>{item.overall_score ?? '–'}</span>
              <span className="stack" style={{ flex: 1, gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{item.company.name} · {item.mode === 'system_design' ? 'System design' : 'Behavioral'}</span>
                <span className="small">
                  {formatDate(item.started_at)}
                  {item.duration_ms ? ` · ${Math.max(1, Math.round(item.duration_ms / 60000))} min` : ''}
                  {item.status !== 'done' && ` · ${statusNames[item.status]}`}
                </span>
              </span>
              {icons.chevron}
            </button>
          ))}
        </section>
      )}
    </main>
  )
}

function Trend({ scores }: { scores: number[] }) {
  const width = 342
  const height = 78
  const min = Math.min(...scores) - 5
  const max = Math.max(...scores) + 5
  const points = scores.map((score, i) => [10 + (i / (scores.length - 1)) * (width - 20), height - 10 - ((score - min) / (max - min)) * (height - 24)])
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <line x1="0" y1={height - 4} x2={width} y2={height - 4} stroke="#EEF1F5" strokeWidth="2" />
      <polyline points={points.map((p) => p.join(',')).join(' ')} fill="none" stroke="#4C82F7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === points.length - 1 ? 6 : 4} fill={i === points.length - 1 ? '#fff' : '#4C82F7'} stroke="#4C82F7" strokeWidth={i === points.length - 1 ? 3 : 0} />
      ))}
    </svg>
  )
}

function formatDate(iso: string) {
  const date = new Date(iso)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
