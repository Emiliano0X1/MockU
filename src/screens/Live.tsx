import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Nav } from '../App'
import { api } from '../api/client'
import { INTERVIEW_LIMIT_SECONDS, WRAP_UP_SECONDS } from '../api/config'
import { connectLive, type LiveConnection } from '../api/live'
import type { Interview, LiveEvent, Question } from '../api/types'
import { Bars, icons, Mocky } from '../components/ui'
import { getBridge, setGlassesLabel, showOnGlasses } from '../glasses/bridge'
import { recordAnswer, type Recording } from '../glasses/recorder'
import { countdownLabel, glassesTexts } from '../glasses/texts'

type Phase = 'starting' | 'waiting' | 'hmm' | 'reading' | 'asking' | 'saving' | 'analyzing'

const COUNTDOWN_FROM = 5
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const LEVEL_HISTORY = 96

export function Live({ interview, nav }: { interview: Interview; nav: Nav }) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [finalRound, setFinalRound] = useState(false)
  const [bpm, setBpm] = useState<number | null>(null)
  const [pulse, setPulse] = useState<number[]>([])
  const [levels, setLevels] = useState<number[]>(() => new Array(LEVEL_HISTORY).fill(0.02))
  const [error, setError] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [pendingWav, setPendingWav] = useState<{ question: Question; wav: Blob } | null>(null)

  const live = useRef<LiveConnection | null>(null)
  const recording = useRef<Recording | null>(null)
  // Ends the current answer right away instead of waiting for silence.
  const finishAnswer = useRef<(() => Promise<void>) | null>(null)
  const startedAt = useRef(Date.now())
  const finalRef = useRef(false)
  const ended = useRef(false)

  const pushLevel = useCallback((level: number) => {
    setLevels((prev) => [...prev.slice(1), Math.max(0.02, level)])
  }, [])

  const saveAnswer = useCallback(async (question: Question, wav: Blob) => {
    setPhase('saving')
    setError('')
    showOnGlasses(finalRef.current ? glassesTexts.finalAnswerReceived() : glassesTexts.answerReceived())
    try {
      await api.uploadAnswer(interview.id, question.id, wav)
      setPendingWav(null)
    } catch {
      setPendingWav({ question, wav })
      setError("Couldn't save that answer.")
      return
    }
    // Never cut an answer short; only stop asking new questions near the limit.
    const elapsedSeconds = (Date.now() - startedAt.current) / 1000
    if (elapsedSeconds >= INTERVIEW_LIMIT_SECONDS - WRAP_UP_SECONDS) {
      ended.current = true
      live.current?.send({ type: 'finish', reason: 'time_limit' })
    } else {
      live.current?.send({ type: 'answer_uploaded', questionId: question.id, elapsedSeconds })
    }
    setPhase('waiting')
  }, [interview.id])

  const ask = useCallback(async (question: Question) => {
    setPhase('reading')
    setError('')
    const view = finalRef.current
      ? glassesTexts.finalQuestion(question.text)
      : question.kind === 'followup'
        ? glassesTexts.followUp(question.text)
        : glassesTexts.question(question.text)
    await showOnGlasses(view)

    // 5 4 3 2 1 GO in the glasses only, then start listening.
    for (let n = COUNTDOWN_FROM; n >= 1; n--) {
      if (ended.current) return
      setGlassesLabel(countdownLabel(n))
      await wait(1000)
    }
    if (ended.current) return
    setGlassesLabel(countdownLabel(0))
    setTimeout(() => setGlassesLabel(view.label), 900)
    setPhase('asking')

    // Silence detection and the manual stop can race; only the first one saves.
    let submitted = false
    const submit = (wav: Blob) => {
      if (submitted) return
      submitted = true
      recording.current = null
      finishAnswer.current = null
      saveAnswer(question, wav)
    }
    const rec = await recordAnswer({ onLevel: pushLevel, onSilenceEnd: submit })
    if (submitted) return
    recording.current = rec
    finishAnswer.current = async () => {
      if (!submitted) submit(await rec.stop())
    }
  }, [pushLevel, saveAnswer])

  // A tap on the glasses also ends the answer.
  useEffect(() => {
    if (phase !== 'asking') return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    getBridge().then((bridge) => {
      if (!bridge || cancelled) return
      unsubscribe = bridge.onEvenHubEvent((event) => {
        const press = event.textEvent ?? event.sysEvent
        // CLICK_EVENT is 0, the protobuf default, so it often arrives with eventType omitted.
        if (press && (press.eventType ?? OsEventTypeList.CLICK_EVENT) === OsEventTypeList.CLICK_EVENT) {
          finishAnswer.current?.()
        }
      })
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [phase])

  const handleEvent = useCallback((event: LiveEvent) => {
    switch (event.type) {
      case 'heart_rate':
        setBpm(event.bpm)
        setPulse((prev) => [...prev.slice(-59), event.bpm])
        break
      case 'question':
        if (ended.current) break
        if (event.question.kind === 'followup' && !finalRef.current) {
          setPhase('hmm')
          setTimeout(() => !ended.current && ask(event.question), 1600)
        } else {
          ask(event.question)
        }
        break
      case 'final_round':
        finalRef.current = true
        setFinalRound(true)
        showOnGlasses(glassesTexts.finalRound())
        break
      case 'analyzing':
        setPhase('analyzing')
        showOnGlasses(glassesTexts.analyzing())
        break
      case 'completed':
        showOnGlasses(glassesTexts.done())
        nav({ name: 'results', resultId: event.resultId })
        break
      case 'error':
        setError(event.message)
        break
    }
  }, [ask, nav])

  // Keep the socket handler pointing at the latest closure without reconnecting.
  const handlerRef = useRef(handleEvent)
  handlerRef.current = handleEvent

  useEffect(() => {
    showOnGlasses(glassesTexts.starting())
    const connection = connectLive(interview.id, (event) => handlerRef.current(event))
    live.current = connection
    connection.send({ type: 'ready' })
    return () => {
      connection.close()
      recording.current?.stop()
    }
  }, [interview.id])

  const endInterview = async () => {
    setConfirmEnd(false)
    ended.current = true
    finishAnswer.current = null
    await recording.current?.stop()
    recording.current = null
    live.current?.send({ type: 'finish', reason: 'user' })
    setPhase('analyzing')
  }

  const inGlasses = phase === 'reading' || phase === 'asking' || finalRound
  const status = statusText(phase, finalRound)

  if (phase === 'analyzing') {
    return (
      <main className="screen stripes center" style={{ justifyContent: 'center', gap: 16 }}>
        <Mocky size={120} className="in" />
        <h1 className="h1">That's the interview.</h1>
        <p className="muted">Mocky is reviewing your answers.<br />This takes a moment.</p>
      </main>
    )
  }

  return (
    <main className="screen stripes" style={{ gap: 14 }}>
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="eyebrow" style={{ color: finalRound ? 'var(--aurora)' : 'var(--sky)' }}>
            {finalRound ? 'Final round' : 'Live interview'}
          </span>
          <h1 className="h2" style={{ fontSize: 24 }}>{interview.company.name}</h1>
        </div>
        <span className="pill" aria-label="Recording">
          <span className="dot live" />
          Live
        </span>
      </header>

      <section className="tiles">
        <div className="card tile" style={{ justifyContent: 'flex-start' }}>
          <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'baseline', gap: 4 }}>
            <span className="display" style={{ fontSize: 30 }}>{bpm ?? '--'}</span>
            <span className="small" style={{ fontWeight: 600, fontSize: 14 }}>bpm</span>
          </div>
          {icons.heart}
        </div>

        <div className={`card tile ${finalRound ? 'final' : phase === 'hmm' ? 'followup' : inGlasses ? 'glasses' : ''}`}>
          {finalRound ? (
            <div style={{ position: 'absolute', left: 14, top: 18 }}>{icons.glasses('#8FB3FF')}</div>
          ) : inGlasses ? (
            <>
              <div style={{ position: 'absolute', left: 14, top: 16 }}>{icons.glasses()}</div>
              <svg className="trail" width="60" height="78" viewBox="0 0 60 78" fill="none" stroke="#4C82F7" strokeLinecap="round">
                <path d="M14 76V30" strokeWidth="3" opacity="0.25" />
                <path d="M30 70V8" strokeWidth="3" opacity="0.5" />
                <path d="M46 76V24" strokeWidth="3" opacity="0.25" />
              </svg>
            </>
          ) : phase === 'hmm' ? (
            <span className="bubble">Hmm…</span>
          ) : null}
          <Mocky
            key={inGlasses ? 'up' : 'down'}
            size={92}
            className={inGlasses ? 'out' : 'in'}
            style={{ position: 'absolute', right: 6, top: 6, transform: phase === 'hmm' ? 'rotate(12deg)' : 'rotate(-20deg)' }}
          />
          <div className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>
              {finalRound ? 'In your glasses' : inGlasses ? 'In your glasses' : 'Live mocky view'}
            </span>
            <span className="dot live" style={{ width: 9, height: 9 }} />
          </div>
        </div>
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Pulse</span>
        <PulseLine values={pulse} />
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Your voice</span>
          <span style={{ fontWeight: 600, fontSize: 12, color: phase === 'asking' ? 'var(--sky)' : 'var(--ink-3)' }}>
            {phase === 'asking' ? 'Listening' : 'Paused'}
          </span>
        </div>
        <div style={{ opacity: phase === 'asking' ? 1 : 0.35, transition: 'opacity 0.3s ease' }}>
          <Bars levels={levels} color="#2F45A8" height={80} />
        </div>
      </section>

      {phase === 'asking' && (
        <button className="btn" onClick={() => finishAnswer.current?.()}>
          I'm done answering
        </button>
      )}

      <section className="row" style={{ gap: 12, paddingTop: 4 }}>
        <div className="stack rise" key={status.title} style={{ flex: 1, gap: 2 }}>
          <span className="display" style={{ fontSize: 18 }}>{error || status.title}</span>
          <span className="small" style={{ fontSize: 14 }}>{error ? '' : status.body}</span>
        </div>
        {pendingWav ? (
          <button className="pill" onClick={() => saveAnswer(pendingWav.question, pendingWav.wav)}>Retry</button>
        ) : (
          <button className="pill" onClick={() => setConfirmEnd(true)}>End</button>
        )}
      </section>

      {confirmEnd && (
        <div className="scrim" onClick={() => setConfirmEnd(false)}>
          <div className="sheet rise stack" style={{ gap: 12, paddingTop: 24 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="h2">End the interview now?</h2>
            <p className="muted">Mocky will review the answers you've given so far.</p>
            <button className="btn" onClick={endInterview}>End and see results</button>
            <button className="btn ghost" onClick={() => setConfirmEnd(false)}>Keep going</button>
          </div>
        </div>
      )}
    </main>
  )
}

function statusText(phase: Phase, finalRound: boolean) {
  if ((phase === 'reading' || phase === 'asking') && finalRound) return { title: 'Final round', body: 'Mocky stays in your glasses until the end.' }
  switch (phase) {
    case 'starting':
      return { title: 'Mocky is with you', body: 'Get comfortable. The first question is coming.' }
    case 'hmm':
      return { title: 'Mocky wants more detail', body: 'A follow-up is coming.' }
    case 'reading':
      return { title: 'Mocky is in your glasses', body: 'Read the question.' }
    case 'asking':
      return { title: 'Mocky is in your glasses', body: 'Take your time. When you finish, tap the button or your glasses.' }
    case 'saving':
      return { title: 'Got it', body: 'Saving your answer…' }
    default:
      return { title: finalRound ? 'Final round' : 'Mocky is with you', body: 'Take a breath.' }
  }
}

function PulseLine({ values }: { values: number[] }) {
  const width = 300
  const height = 90
  if (values.length < 2) {
    return (
      <div className="small" style={{ height, display: 'flex', alignItems: 'center' }}>
        Waiting for your heart rate…
      </div>
    )
  }
  const min = Math.min(...values) - 4
  const max = Math.max(...values) + 4
  const points = values.map((value, i) => [
    (i / (values.length - 1)) * (width - 12) + 6,
    height - 8 - ((value - min) / (max - min)) * (height - 16),
  ])
  const last = points[points.length - 1]!
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label={`Heart rate between ${Math.round(min + 4)} and ${Math.round(max - 4)} bpm`}>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={width} y1={height * f} y2={height * f} stroke="#EEF1F5" />
      ))}
      <polyline points={points.map((p) => p.join(',')).join(' ')} fill="none" stroke="#4C82F7" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="5" fill="#fff" stroke="#4C82F7" strokeWidth="3" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
