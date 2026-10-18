import { useEffect, useRef, useState } from 'react'
import type { Nav } from '../App'
import { api, errorMessage } from '../api/client'
import { BRIEFING_SECONDS } from '../api/config'
import type { Company, Profile, ResumeInfo, SessionMode } from '../api/types'
import { BackButton, formatTime, Mocky } from '../components/ui'
import { showOnGlasses } from '../glasses/bridge'
import { useGlassesInput } from '../glasses/input'
import { glassesTexts } from '../glasses/texts'

function companySummary(company: Company) {
  const parts = [
    company.industry,
    company.culture_summary,
    company.values.length ? `Values\n${company.values.map((v) => `- ${v.name}: ${v.description}`).join('\n')}` : '',
    'Swipe to scroll. Double press when you are ready.',
  ]
  return parts.filter(Boolean).join('\n\n')
}

type Props = { company: Company; mode: SessionMode; profile: Profile; resume: ResumeInfo; nav: Nav }

export function Briefing({ company, mode, profile, resume, nav }: Props) {
  const design = mode === 'system_design'
  const accent = design ? 'var(--aurora)' : 'var(--sky)'
  const [left, setLeft] = useState(BRIEFING_SECONDS)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const startedRef = useRef(false)

  // The same summary as the phone, as scrollable text in the glasses.
  useEffect(() => {
    showOnGlasses(glassesTexts.briefingSummary(company.name, companySummary(company)))
    const started = Date.now()
    const tick = setInterval(() => setLeft(Math.max(0, BRIEFING_SECONDS - (Date.now() - started) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [company])

  // Swipe scrolls the text natively; double press means "I'm ready".
  useGlassesInput((input) => {
    if (input.kind === 'double') begin()
  })

  // Creating the session starts the interview clock on the server, so it
  // happens only when the candidate is ready (or the briefing runs out).
  const begin = async () => {
    if (startedRef.current) return
    startedRef.current = true
    setStarting(true)
    setError('')
    try {
      const session = await api.createSession(profile.id, company.id, resume.id, mode)
      if (session.questions.length === 0) {
        // The server's question bank is empty; don't run an empty interview.
        api.deleteSession(session.id).catch(() => {})
        throw new Error('The server has no interview questions yet. Add some to the questions table and try again.')
      }
      nav(design ? { name: 'systemDesign', session, company } : { name: 'live', session, company })
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
            <span className="eyebrow" style={{ color: accent }}>{design ? 'Your design challenge is with' : 'Your interview is with'}</span>
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
              stroke={accent}
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
                <span className="display" style={{ fontSize: 15, color: accent, width: 22, flexShrink: 0 }}>
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
            {design
              ? 'Think out loud: requirements first, then components, data flow, how it scales, and the trade-offs you made. The challenge appears in your glasses.'
              : 'Pick one value above and have a story from your resume that shows it. Questions appear in your glasses, one at a time.'}
          </p>
        </section>

        {design && (
          <section className="stack" style={{ gap: 10 }}>
            <h2 className="eyebrow">How it works</h2>
            {[
              'Read the challenge in your glasses, then explain your design out loud.',
              'Press the glasses (or tap Done) when you finish. Mocky draws your diagram.',
              'Review the diagram and submit it for grading. You get one attempt.',
            ].map((step, i) => (
              <div key={step} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span className="display" style={{ fontSize: 15, color: accent, width: 22, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 14, lineHeight: '20px' }}>{step}</span>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="spacer" />
      {error && <p className="error" role="alert" style={{ paddingBottom: 8 }}>{error}</p>}
      <div className="bottom-bar">
        <Mocky size={52} />
        <button className="btn" style={{ flex: 1, background: accent }} disabled={starting} onClick={begin}>
          {starting ? 'Starting…' : "I'm ready, start now"}
        </button>
      </div>
    </main>
  )
}
