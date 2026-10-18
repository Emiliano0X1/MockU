import { useEffect, useState } from 'react'
import type { Nav } from '../App'
import type { Interview } from '../api/types'
import { formatTime, Mocky } from '../components/ui'
import { showOnGlasses } from '../glasses/bridge'
import { glassesTexts } from '../glasses/texts'

export function Briefing({ interview, nav }: { interview: Interview; nav: Nav }) {
  const { company, briefingSeconds } = interview
  const [left, setLeft] = useState(briefingSeconds)

  useEffect(() => {
    showOnGlasses(glassesTexts.briefing(company.name))
    const started = Date.now()
    const tick = setInterval(() => setLeft(Math.max(0, briefingSeconds - (Date.now() - started) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [company.name, briefingSeconds])

  useEffect(() => {
    if (left <= 0) nav({ name: 'live', interview })
  }, [left, interview, nav])

  const progress = left / briefingSeconds
  const circumference = 2 * Math.PI * 34

  return (
    <main className="screen">
      <header className="row" style={{ alignItems: 'flex-end', gap: 12, paddingBottom: 16, borderBottom: '2px solid var(--line)', margin: '0 -24px', padding: '8px 24px 16px' }}>
        <div className="stack" style={{ gap: 4, flex: 1 }}>
          <span className="eyebrow" style={{ color: 'var(--sky)' }}>Your interview is with</span>
          <h1 className="h1" style={{ fontSize: 32 }}>{company.name}</h1>
          <span className="small" style={{ fontSize: 14 }}>{company.tagline}</span>
        </div>
        <div className="timer-ring" aria-label={`${formatTime(left)} left to read`}>
          <svg width="76" height="76" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r="34" fill="none" stroke="var(--line)" strokeWidth="5" />
            <circle
              cx="38"
              cy="38"
              r="34"
              fill="none"
              stroke="var(--sky)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              transform="rotate(-90 38 38)"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <span className="display" style={{ fontSize: 20, lineHeight: '22px' }}>{formatTime(left)}</span>
          <span className="eyebrow" style={{ fontSize: 10, letterSpacing: '0.08em' }}>to read</span>
        </div>
      </header>

      <div className="stack" style={{ gap: 20, paddingTop: 18, paddingBottom: 24 }}>
        <section className="stack" style={{ gap: 6 }}>
          <h2 className="eyebrow">About</h2>
          <p style={{ fontSize: 15, lineHeight: '23px' }}>{company.about}</p>
        </section>

        <section className="stack" style={{ gap: 8 }}>
          <h2 className="eyebrow">Values</h2>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {company.values.map((value) => (
              <span key={value} className="value-chip">{value}</span>
            ))}
          </div>
        </section>

        <section className="stack" style={{ gap: 10 }}>
          <h2 className="eyebrow">Current projects</h2>
          {company.projects.map((project, i) => (
            <div key={project.name} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
              <span className="display" style={{ fontSize: 15, color: 'var(--sky)', width: 22, flexShrink: 0 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="stack" style={{ gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{project.name}</span>
                <span className="small" style={{ fontSize: 14, lineHeight: '20px' }}>{project.description}</span>
              </span>
            </div>
          ))}
        </section>

        {company.tip && (
          <section className="tip stack" style={{ gap: 4 }}>
            <span className="eyebrow" style={{ color: 'var(--aurora)' }}>Mocky's tip</span>
            <p style={{ fontSize: 14, lineHeight: '20px' }}>{company.tip}</p>
          </section>
        )}
      </div>

      <div className="spacer" />
      <div className="bottom-bar">
        <Mocky size={52} />
        <button className="btn" style={{ flex: 1 }} onClick={() => nav({ name: 'live', interview })}>
          I'm ready, start now
        </button>
      </div>
    </main>
  )
}
