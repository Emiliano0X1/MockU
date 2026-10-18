import { useCallback, useEffect, useRef, useState } from 'react'
import type { Nav } from '../App'
import { api, ApiError, errorMessage } from '../api/client'
import { BREATHER_SECONDS, INTERVIEW_LIMIT_SECONDS, SILENCE_SECONDS_TO_END } from '../api/config'
import { connectGlassesSocket } from '../api/live'
import type { Company, GlassesMessage, SessionCreated } from '../api/types'
import { Bars, formatTime, icons, Mocky } from '../components/ui'
import { setGlassesLabel, showOnGlasses, type GlassesView } from '../glasses/bridge'
import { useGlassesInput } from '../glasses/input'
import { recordSession, type SessionRecording } from '../glasses/recorder'
import { answeringLabel, countdownLabel, glassesTexts, tipLabel } from '../glasses/texts'

type Phase = 'starting' | 'reading' | 'asking' | 'breather' | 'saving' | 'failed'
type Sensor = { state: 'connecting' | 'online' | 'offline' | 'unavailable'; lastBpm: number | null }

const COUNTDOWN_FROM = 5
const LEVEL_HISTORY = 96
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Waits for the end of the current answer: silence after speech, a tap on the
// glasses, or the "I'm done" button.
type Answer = { heardSpeech: boolean; silentSince: number | null; resolve: () => void }

export function Live({ session, company, nav }: { session: SessionCreated; company: Company; nav: Nav }) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [sensor, setSensor] = useState<Sensor>({ state: 'connecting', lastBpm: null })
  const [tip, setTip] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>(() => new Array(LEVEL_HISTORY).fill(0.02))
  const [error, setError] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)

  // The server set t = 0 when it created the session, just before we got here.
  const t0 = useRef(performance.now())
  const elapsedMs = () => Math.round(performance.now() - t0.current)

  const recording = useRef<Promise<SessionRecording> | null>(null)
  const answer = useRef<Answer | null>(null)
  const finishing = useRef(false)
  const pendingUpload = useRef<{ wav: Blob; durationMs: number } | null>(null)

  // The glasses label line shows the countdown or question label, unless a
  // heart-rate tip is showing on top of it. While "End the interview?" is up
  // in the glasses, page and label updates are held and replayed on cancel.
  const baseLabel = useRef('')
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const confirming = useRef(false)
  const pageView = useRef<GlassesView>(glassesTexts.starting())
  const setLabel = (label: string) => {
    baseLabel.current = label
    if (!tipTimer.current && !confirming.current) setGlassesLabel(label)
  }
  const showPage = (view: GlassesView) => {
    pageView.current = view
    baseLabel.current = view.label
    return confirming.current ? Promise.resolve(true) : showOnGlasses(view)
  }

  // Seconds spent on the current answer, on the phone and in the glasses.
  const [answerSeconds, setAnswerSeconds] = useState(0)

  const endAnswer = useCallback(() => {
    const current = answer.current
    answer.current = null
    current?.resolve()
  }, [])

  const onAudio = useCallback(
    (level: number, speech: boolean) => {
      setLevels((prev) => [...prev.slice(1), Math.max(0.02, level)])
      const current = answer.current
      if (!current) return
      if (speech) {
        current.heardSpeech = true
        current.silentSince = null
      } else if (current.heardSpeech) {
        current.silentSince ??= performance.now()
        if (performance.now() - current.silentSince >= SILENCE_SECONDS_TO_END * 1000) endAnswer()
      }
    },
    [endAnswer],
  )

  const upload = useCallback(async () => {
    const pending = pendingUpload.current
    if (!pending) return
    setPhase('saving')
    setError('')
    try {
      try {
        await api.endSession(session.id)
      } catch (err) {
        // Already past 'recording' means a previous attempt uploaded the audio.
        if (!(err instanceof ApiError && err.code === 'SESSION_NOT_RECORDING')) throw err
        pendingUpload.current = null
        return nav({ name: 'results', sessionId: session.id })
      }
      try {
        await api.uploadAudio(session.id, pending.wav, pending.durationMs)
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'AUDIO_ALREADY_EXISTS')) throw err
      }
      pendingUpload.current = null
      nav({ name: 'results', sessionId: session.id })
    } catch (err) {
      setPhase('failed')
      setError(errorMessage(err, "Couldn't save your interview."))
    }
  }, [session.id, nav])

  const finish = useCallback(async () => {
    if (finishing.current) return
    finishing.current = true
    confirming.current = false
    answer.current = null
    setConfirmEnd(false)
    setPhase('saving')
    showOnGlasses(glassesTexts.analyzing())
    try {
      const rec = await recording.current
      pendingUpload.current = rec ? await rec.stop() : null
    } catch (err) {
      setPhase('failed')
      setError(errorMessage(err, "Couldn't stop the recording."))
      return
    }
    if (!pendingUpload.current) {
      setPhase('failed')
      setError('No recording was made for this interview.')
      return
    }
    upload()
  }, [upload])

  const handleMessage = useCallback((message: GlassesMessage) => {
    // DEBUG: live channel traffic (heart rate and tips).
    if (message.type === 'suggestion') {
      console.log(`[live] tip at t=${(message.t_ms / 1000).toFixed(1)}s (${message.severity}, ${message.ttl_ms}ms): "${message.text}"${confirming.current ? ' (held: end-confirmation open)' : ''}`)
    } else if (message.type === 'sensor_status') {
      console.log(`[live] watch ${message.state}, ${message.last_bpm ?? '--'} bpm`)
    } else {
      console.log('[live]', message)
    }
    if (message.type === 'sensor_status') {
      setSensor({ state: message.state, lastBpm: message.last_bpm })
    } else if (message.type === 'suggestion') {
      clearTimeout(tipTimer.current)
      setTip(message.text)
      if (!confirming.current) setGlassesLabel(tipLabel(message.text))
      tipTimer.current = setTimeout(() => {
        tipTimer.current = undefined
        setTip(null)
        if (!confirming.current) setGlassesLabel(baseLabel.current)
      }, message.ttl_ms)
    }
  }, [])

  // Runs the interview once per session. Started on the next tick so React
  // StrictMode's mount/unmount/mount in dev doesn't open the mic twice.
  const handlerRef = useRef({ onAudio, finish, handleMessage, endAnswer })
  handlerRef.current = { onAudio, finish, handleMessage, endAnswer }
  useEffect(() => {
    let cancelled = false
    let closeSocket = () => {}

    const run = async () => {
      const h = () => handlerRef.current
      showPage(glassesTexts.starting())
      recording.current = recordSession({ startedAt: t0.current, onAudio: (level, speech) => h().onAudio(level, speech) })
      recording.current.catch(() => {})
      const socket = connectGlassesSocket(
        session.id,
        (message) => h().handleMessage(message),
        () => setSensor((s) => (s.state === 'connecting' ? { ...s, state: 'unavailable' } : s)),
      )
      closeSocket = socket.close

      await wait(2500)
      for (const [i, question] of session.questions.entries()) {
        if (cancelled || finishing.current) return
        setPhase('reading')
        const view = glassesTexts.question(question.text)
        await showPage(view)
        api.markQuestionShown(session.id, question.position, elapsedMs()).catch((err) => console.warn('Question timing not saved', err))

        // 5 4 3 2 1 GO in the glasses only, then listen.
        for (let n = COUNTDOWN_FROM; n >= 1; n--) {
          if (cancelled || finishing.current) return
          setLabel(countdownLabel(n))
          await wait(1000)
        }
        // "GO" stays up until the elapsed-time label takes over a second later.
        setLabel(countdownLabel(0))
        setPhase('asking')
        await new Promise<void>((resolve) => (answer.current = { heardSpeech: false, silentSince: null, resolve }))
        if (cancelled || finishing.current) return

        const last = i === session.questions.length - 1
        if (last || elapsedMs() / 1000 >= INTERVIEW_LIMIT_SECONDS) break
        setPhase('breather')
        await showPage(glassesTexts.answerReceived())
        await wait(BREATHER_SECONDS * 1000)
      }
      if (!cancelled) h().finish()
    }

    const start = setTimeout(run, 0)
    return () => {
      cancelled = true
      clearTimeout(start)
      clearTimeout(tipTimer.current)
      closeSocket()
      answer.current?.resolve()
      answer.current = null
      // Leaving mid-interview: release the mic, and end the session on the server
      // so it stops tracking the watch (it allows one live interview at a time).
      // finish() already did both otherwise.
      if (!finishing.current && recording.current) {
        recording.current.then((rec) => rec.stop()).catch(() => {})
        api.endSession(session.id).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // Glasses: press ends the answer; double press asks "End the interview?",
  // answered from a list in the glasses (or the same sheet on the phone).
  useGlassesInput((input) => {
    if (phase === 'saving' || phase === 'failed') return
    if (confirmEnd) {
      if (input.kind === 'select' && input.index === 1) finish()
      else if (input.kind === 'select' || input.kind === 'double') setConfirmEnd(false)
      return
    }
    if (input.kind === 'press' && phase === 'asking') endAnswer()
    else if (input.kind === 'double') setConfirmEnd(true)
  })

  // Mirror the end-confirmation into the glasses, and put the interview back on cancel.
  useEffect(() => {
    if (finishing.current) return
    if (confirmEnd) {
      confirming.current = true
      showOnGlasses(glassesTexts.confirmEnd())
    } else if (confirming.current) {
      confirming.current = false
      showOnGlasses({ ...pageView.current, label: tipTimer.current && tip ? tipLabel(tip) : baseLabel.current })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmEnd])

  // Elapsed time on the current answer.
  useEffect(() => {
    if (phase !== 'asking') return
    const started = performance.now()
    setAnswerSeconds(0)
    const tick = setInterval(() => {
      const seconds = Math.floor((performance.now() - started) / 1000)
      setAnswerSeconds(seconds)
      setLabel(answeringLabel(seconds))
    }, 1000)
    return () => clearInterval(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const inGlasses = phase === 'reading' || phase === 'asking'

  if (phase === 'saving' || phase === 'failed') {
    return (
      <main className="screen stripes center" style={{ justifyContent: 'center', gap: 16 }}>
        <Mocky size={120} className="in" />
        <h1 className="h1">That's the interview.</h1>
        {phase === 'saving' ? (
          <p className="muted">Sending your answers to Mocky…</p>
        ) : (
          <>
            <p className="error" role="alert">{error}</p>
            {pendingUpload.current && <button className="btn" onClick={upload}>Try again</button>}
            <button className="btn ghost" onClick={() => nav({ name: 'home' })}>Back home</button>
          </>
        )}
      </main>
    )
  }

  const status = tip
    ? { title: tip, body: 'Mocky noticed your heart rate rising.' }
    : statusText(phase)

  return (
    <main className="screen stripes" style={{ gap: 14 }}>
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="eyebrow" style={{ color: 'var(--sky)' }}>Live interview</span>
          <h1 className="h2" style={{ fontSize: 24 }}>{company.name}</h1>
        </div>
        <span className="pill" aria-label="Recording">
          <span className="dot live" />
          Live
        </span>
      </header>

      <section className="tiles">
        <div className="card tile" style={{ justifyContent: 'flex-start' }}>
          <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'baseline', gap: 4 }}>
            <span className="display" style={{ fontSize: 30 }}>{sensor.state === 'online' && sensor.lastBpm ? sensor.lastBpm : '--'}</span>
            <span className="small" style={{ fontWeight: 600, fontSize: 14 }}>bpm</span>
          </div>
          {icons.heart}
          <span className="small" style={{ position: 'relative', fontWeight: 700, fontSize: 12, textAlign: 'right' }}>
            {sensorText(sensor.state)}
          </span>
        </div>

        <div className={`card tile ${inGlasses ? 'glasses' : ''}`}>
          {inGlasses && (
            <>
              <div style={{ position: 'absolute', left: 14, top: 16 }}>{icons.glasses()}</div>
              <svg className="trail" width="60" height="78" viewBox="0 0 60 78" fill="none" stroke="#4C82F7" strokeLinecap="round">
                <path d="M14 76V30" strokeWidth="3" opacity="0.25" />
                <path d="M30 70V8" strokeWidth="3" opacity="0.5" />
                <path d="M46 76V24" strokeWidth="3" opacity="0.25" />
              </svg>
            </>
          )}
          <Mocky
            key={inGlasses ? 'up' : 'down'}
            size={92}
            className={inGlasses ? 'out' : 'in'}
            style={{ position: 'absolute', right: 6, top: 6, transform: 'rotate(-20deg)' }}
          />
          <div className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{inGlasses ? 'In your glasses' : 'Live mocky view'}</span>
            <span className="dot live" style={{ width: 9, height: 9 }} />
          </div>
        </div>
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Your voice</span>
          <span style={{ fontWeight: 600, fontSize: 12, color: phase === 'asking' ? 'var(--sky)' : 'var(--ink-3)' }}>
            {phase === 'asking' ? `Listening · ${formatTime(answerSeconds)}` : 'Recording'}
          </span>
        </div>
        <div style={{ opacity: phase === 'asking' ? 1 : 0.35, transition: 'opacity 0.3s ease' }}>
          <Bars levels={levels} color="#2F45A8" height={80} />
        </div>
      </section>

      {phase === 'asking' && (
        <button className="btn" onClick={endAnswer}>
          I'm done answering
        </button>
      )}

      <section className="row" style={{ gap: 12, paddingTop: 4 }}>
        <div className="stack rise" key={status.title} style={{ flex: 1, gap: 2 }}>
          <span className="display" style={{ fontSize: 18, color: tip ? 'var(--bad-ink)' : undefined }}>{status.title}</span>
          <span className="small" style={{ fontSize: 14 }}>{status.body}</span>
        </div>
        <button className="pill" onClick={() => setConfirmEnd(true)}>End</button>
      </section>

      {confirmEnd && (
        <div className="scrim" onClick={() => setConfirmEnd(false)}>
          <div className="sheet rise stack" style={{ gap: 12, paddingTop: 24 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="h2">End the interview now?</h2>
            <p className="muted">Mocky will review the answers you've given so far.</p>
            <button className="btn" onClick={finish}>End and see results</button>
            <button className="btn ghost" onClick={() => setConfirmEnd(false)}>Keep going</button>
          </div>
        </div>
      )}
    </main>
  )
}

function sensorText(state: Sensor['state']) {
  switch (state) {
    case 'connecting':
      return 'Connecting…'
    case 'online':
      return 'Watch connected'
    case 'offline':
      return 'Watch offline'
    case 'unavailable':
      return 'Live link down'
  }
}

function statusText(phase: Phase) {
  switch (phase) {
    case 'starting':
      return { title: 'Mocky is with you', body: 'Get comfortable. The first question is coming.' }
    case 'reading':
      return { title: 'Mocky is in your glasses', body: 'Read the question.' }
    case 'asking':
      return { title: 'Mocky is in your glasses', body: 'Take your time. When you finish, tap the button or your glasses.' }
    default:
      return { title: 'Got it', body: 'Take a breath. The next question is coming.' }
  }
}
