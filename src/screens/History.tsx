import { useEffect, useState } from 'react'
import type { Nav } from '../App'
import { api } from '../api/client'
import type { HistoryItem } from '../api/types'
import { BackButton, icons, Mocky } from '../components/ui'

export function History({ nav }: { nav: Nav }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.history().then(setItems).catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your mocks."))
  }, [])

  const latest = items?.[0]
  const first = items?.[items.length - 1]

  return (
    <main className="screen">
      <header className="row" style={{ gap: 12 }}>
        <BackButton onClick={() => nav({ name: 'home' })} />
        <h1 className="h2" style={{ flex: 1 }}>Your mocks</h1>
      </header>

      {error && <p className="error" style={{ paddingTop: 20 }}>{error}</p>}
      {items && items.length === 0 && (
        <div className="stack center" style={{ gap: 10, paddingTop: 80 }}>
          <Mocky size={96} />
          <p className="muted">Your finished mocks will show up here.</p>
        </div>
      )}

      {latest && first && (
        <>
          <section className="stack" style={{ gap: 6, paddingTop: 18 }}>
            <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
              <span className="display" style={{ fontWeight: 700, fontSize: 56, lineHeight: '56px', letterSpacing: '-0.02em' }}>{latest.score}</span>
              <span className="stack" style={{ paddingBottom: 6 }}>
                {items!.length > 1 && (
                  <span style={{ fontWeight: 700, fontSize: 13, color: latest.score >= first.score ? 'var(--good)' : 'var(--bad-ink)' }}>
                    {latest.score >= first.score ? '+' : ''}{latest.score - first.score} since your first mock
                  </span>
                )}
                <span className="small">Latest score</span>
              </span>
            </div>
            {items!.length > 1 && <Trend scores={[...items!].reverse().map((item) => item.score)} />}
          </section>

          <Recurring items={items!} />

          <section className="stack" style={{ paddingTop: 18 }}>
            <h2 className="eyebrow" style={{ paddingBottom: 4 }}>All summaries</h2>
            {items!.map((item, i) => (
              <button key={`${item.resultId}-${i}`} className="list-row" onClick={() => nav({ name: 'results', resultId: item.resultId })}>
                <span className={`score-badge ${i === 0 ? 'latest' : ''}`}>{item.score}</span>
                <span className="stack" style={{ flex: 1, gap: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{item.companyName} · Behavioral</span>
                  <span className="small">{formatDate(item.createdAt)} · {item.topSignal}</span>
                </span>
                {icons.chevron}
              </button>
            ))}
          </section>
        </>
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

// Points out the weak spot that shows up most across saved mocks.
function Recurring({ items }: { items: HistoryItem[] }) {
  if (items.length < 2) return null
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.topSignal, (counts.get(item.topSignal) ?? 0) + 1)
  const [signal, count] = [...counts].sort((a, b) => b[1] - a[1])[0]!
  if (count < 2) return null
  return (
    <section className="row" style={{ gap: 12, marginTop: 14, background: '#FFF4F4', border: '2px solid #F7CFCF', borderRadius: 18, padding: '12px 14px' }}>
      <Mocky size={44} style={{ flexShrink: 0 }} />
      <span className="stack" style={{ gap: 2 }}>
        <span className="eyebrow" style={{ color: 'var(--bad-ink)' }}>Keeps coming back</span>
        <span style={{ fontWeight: 600, fontSize: 14, lineHeight: '20px' }}>
          {signal} was your top weak spot in {count} of your {items.length} mocks.
        </span>
      </span>
    </section>
  )
}

function formatDate(iso: string) {
  const date = new Date(iso)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
