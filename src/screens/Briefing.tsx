import { useEffect, useRef, useState } from 'react'
import type { Nav } from '../App'
import { api, errorMessage } from '../api/client'
import { BRIEFING_SECONDS } from '../api/config'
import type { Company, Profile, ResumeInfo } from '../api/types'
import { BackButton, formatTime, Mocky } from '../components/ui'
import { showOnGlasses } from '../glasses/bridge'
import { glassesTexts } from '../glasses/texts'

type Props = { company: Company; profile: Profile; resume: ResumeInfo; nav: Nav }

export function Briefing({ company, profile, resume, nav }: Props) {
  const [left, setLeft] = useState(BRIEFING_SECONDS)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const startedRef = useRef(false)

  useEffect(() => {
    showOnGlasses(glassesTexts.briefing(company.name))
    const started = Date.now()
    const tick = setInterval(() => setLeft(Math.max(0, BRIEFING_SECONDS - (Date.now() - started) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [company.name])

  // Creating the session starts the interview clock on the server, so it
  // happens only when the candidate is ready (or the briefing runs out).
  const begin = async () => {
    if (startedRef.current) return
    startedRef.current = true
    setStarting(true)
    setError('')
    try {
      const session = await api.createSession(profile.id, company.id, resume.id)
      nav({ name: 'live', session, company })
    } catch (err) {
      startedRef.current = false
      setStarting(false)
      setError(errorMessage(err, "Couldn't start the interview. Try again."))
    }
  }

  const beginRef = useRef(begin)
  beginRef.current = begin
  useEffect(() => {
    if (left <= 0) beginRef.current()
  }, [left])

  const progress = left / BRIEFING_SECONDS
  const circumference = 2 * Math.PI * 34
  const tagline = [company.industry, company.website_url?.replace(/^https?:\/\//, '').replace(/\/$/, '')].filter(Boolean).join(' · ')

  return (
    <main className="screen">
      <header className="row" style={{ alignItems: 'flex-end', gap: 12, paddingBottom: 16, borderBottom: '2px solid var(--line)', margin: '0 -24px', padding: '8px 24px 16px' }}>
        <div className="stack" style={{ gap: 4, flex: 1 }}>
          <div className="row" style={{ gap: 10 }}>
            <BackButton onClick={() => nav({ name: 'home' })} />
            <span className="eyebrow" style={{ color: 'var(--sky)' }}>Your interview is with</span>
          </div>
          <h1 className="h1" style={{ fontSize: 32 }}>{company.name}</h1>
          {tagline && <span className="small" style={{ fontSize: 14 }}>{tagline}</span>}
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
        {company.culture_summary && (
          <section className="stack" style={{ gap: 6 }}>
            <h2 className="eyebrow">Culture</h2>
            <p style={{ fontSize: 15, lineHeight: '23px' }}>{company.culture_summary}</p>
          </section>
        )}

        {company.values.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
            <h2 className="eyebrow">Values</h2>
            {company.values.map((value, i) => (
              <div key={value.name} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span className="display" style={{ fontSize: 15, color: 'var(--sky)', width: 22, flexShrink: 0 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="stack" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{value.name}</span>
                  <span className="small" style={{ fontSize: 14, lineHeight: '20px' }}>{value.description}</span>
                </span>
              </div>
            ))}
          </section>
        )}

        <section className="tip stack" style={{ gap: 4 }}>
          <span className="eyebrow" style={{ color: 'var(--aurora)' }}>Mocky's tip</span>
          <p style={{ fontSize: 14, lineHeight: '20px' }}>
            Pick one value above and have a story from your resume that shows it. Questions appear in your glasses, one at a time.
          </p>
        </section>
      </div>

      <div className="spacer" />
      {error && <p className="error" role="alert" style={{ paddingBottom: 8 }}>{error}</p>}
      <div className="bottom-bar">
        <Mocky size={52} />
        <button className="btn" style={{ flex: 1 }} disabled={starting} onClick={begin}>
          {starting ? 'Starting…' : "I'm ready, start now"}
        </button>
      </div>
    </main>
  )
}
