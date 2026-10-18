import { useCallback, useEffect, useRef, useState } from 'react'
import type { Nav } from '../App'
import { api, errorMessage } from '../api/client'
import { connectGlassesSocket } from '../api/live'
import type { Company, GlassesMessage, SessionCreated, SystemDesignGraph } from '../api/types'
import { DiagramView } from '../components/DiagramView'
import { Bars, formatTime, icons, Mocky } from '../components/ui'
import { setGlassesLabel, showOnGlasses, type GlassesView } from '../glasses/bridge'
import { useGlassesInput } from '../glasses/input'
import { recordSession, type SessionRecording } from '../glasses/recorder'
import { countdownLabel, explainingLabel, glassesTexts, tipLabel } from '../glasses/texts'

// Same rhythm as the behavioral interview (Live.tsx): the challenge appears in
// the glasses, 5-4-3-2-1-GO, then the candidate explains out loud. Unique to
// system design: one attempt, Mocky draws a diagram from the explanation, and
// the candidate reviews it before submitting it for grading.
type Phase = 'starting' | 'reading' | 'explaining' | 'drawing' | 'review' | 'submitting' | 'failed'
type Sensor = { state: 'connecting' | 'online' | 'offline' | 'unavailable'; lastBpm: number | null }
type Confirm = 'end' | 'cancel' | null

const COUNTDOWN_FROM = 5
const LEVEL_HISTORY = 96
const DIAGRAM_POLL_MS = 2000
const DIAGRAM_TIMEOUT_MS = 3 * 60 * 1000
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function SystemDesign({ session, company, nav }: { session: SessionCreated; company: Company; nav: Nav }) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [sensor, setSensor] = useState<Sensor>({ state: 'connecting', lastBpm: null })
  const [tip, setTip] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>(() => new Array(LEVEL_HISTORY).fill(0.02))
  const [seconds, setSeconds] = useState(0)
  const [graph, setGraph] = useState<SystemDesignGraph | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [error, setError] = useState('')

  const question = session.questions[0]
  const prompt = question?.text ?? 'Design a scalable web service'

  // The server set t = 0 when it created the session, just before we got here.
  const t0 = useRef(performance.now())
  const elapsedMs = () => Math.round(performance.now() - t0.current)
  const recording = useRef<Promise<SessionRecording> | null>(null)
  const doneExplaining = useRef<(() => void) | null>(null)
  const uploaded = useRef(false)
  const finishing = useRef(false)
  const pending = useRef<{ wav: Blob; durationMs: number } | null>(null)

  // Glasses label/page handling, as in Live: tips and the confirm list sit on
  // top of the current page and put it back when they close.
  const pageView = useRef<GlassesView>(glassesTexts.starting())
  const baseLabel = useRef('')
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const confirming = useRef(false)
  const setLabel = (label: string) => {
    baseLabel.current = label
    if (!tipTimer.current && !confirming.current) setGlassesLabel(label)
  }
  const showPage = (view: GlassesView) => {
    pageView.current = view
    baseLabel.current = view.label
    return confirming.current ? Promise.resolve(true) : showOnGlasses(view)
  }

  const onAudio = useCallback((level: number) => {
    setLevels((prev) => [...prev.slice(1), Math.max(0.02, level)])
  }, [])

  // Diagram: wait for the server to draw it (socket push or polling).
  const loadDiagram = useCallback(async () => {
    const diagram = await api.getSystemDesignDiagram(session.id)
    if (diagram.status === 'failed') throw new Error(diagram.message || "Mocky couldn't draw your diagram.")
    if (diagram.status !== 'ready' && diagram.status !== 'accepted') return false
    if (!diagram.graph) return false
    setGraph(diagram.graph)
    setPhase('review')
    showPage(glassesTexts.systemDesignReview(diagram.graph.nodes.map((n) => n.label)))
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  const waitForDiagram = useCallback(async () => {
    const deadline = performance.now() + DIAGRAM_TIMEOUT_MS
    while (performance.now() < deadline) {
      if (!finishing.current) return
      try {
        if (await loadDiagram()) return
      } catch (err) {
        setError(errorMessage(err, "Mocky couldn't draw your diagram."))
        setPhase('failed')
        return
      }
      await wait(DIAGRAM_POLL_MS)
    }
    setError('Drawing the diagram is taking too long. Try again in a moment.')
    setPhase('failed')
  }, [loadDiagram])

  const upload = useCallback(async () => {
    const attempt = pending.current
    if (!attempt) return
    setPhase('drawing')
    setError('')
    showPage(glassesTexts.systemDesignInterpreting())
    try {
      await api.uploadSystemDesignAttempt(session.id, attempt.wav, attempt.durationMs, 1)
      uploaded.current = true
      pending.current = null
      waitForDiagram()
    } catch (err) {
      setPhase('failed')
      setError(errorMessage(err, "Couldn't send your explanation."))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, waitForDiagram])

  // Stop the mic and send the explanation to be drawn.
  const finishExplaining = useCallback(async () => {
    if (finishing.current) return
    finishing.current = true
    confirming.current = false
    setConfirm(null)
    doneExplaining.current?.()
    try {
      const rec = await recording.current
      pending.current = rec ? await rec.stop() : null
    } catch (err) {
      setPhase('failed')
      setError(errorMessage(err, "Couldn't stop the recording."))
      return
    }
    if (!pending.current) {
      setPhase('failed')
      setError('No recording was made for this challenge.')
      return
    }
    upload()
  }, [upload])

  // Leave without a diagram: release the mic and close the session on the server.
  const quit = useCallback(async () => {
    finishing.current = true
    confirming.current = false
    setConfirm(null)
    recording.current?.then((rec) => rec.stop()).catch(() => {})
    api.endSession(session.id).catch(() => {})
    nav({ name: 'home' })
  }, [session.id, nav])

  const submit = useCallback(async () => {
    setPhase('submitting')
    setError('')
    showOnGlasses(glassesTexts.systemDesignGrading())
    try {
      await api.acceptSystemDesignDiagram(session.id, 1)
      nav({ name: 'results', sessionId: session.id })
    } catch (err) {
      setPhase('review')
      setError(errorMessage(err, "Couldn't submit your diagram."))
      showPage(pageView.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, nav])

  const cancelAttempt = useCallback(async () => {
    confirming.current = false
    setConfirm(null)
    try {
      await api.rejectSystemDesignDiagram(session.id, 1, 'Candidate cancelled')
      nav({ name: 'home' })
    } catch (err) {
      setError(errorMessage(err, "Couldn't cancel the attempt."))
    }
  }, [session.id, nav])

  const handleMessage = useCallback((message: GlassesMessage) => {
    console.log('[live]', message) // DEBUG
    if (message.type === 'sensor_status') {
      setSensor({ state: message.state, lastBpm: message.last_bpm })
    } else if (message.type === 'diagram_ready') {
      loadDiagram().catch(() => {})
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
  }, [loadDiagram])

  // Runs the challenge once per session. Started on the next tick so React
  // StrictMode's mount/unmount/mount in dev doesn't open the mic twice.
  const handlers = useRef({ onAudio, handleMessage, finishExplaining })
  handlers.current = { onAudio, handleMessage, finishExplaining }
  useEffect(() => {
    let cancelled = false
    let closeSocket = () => {}

    const run = async () => {
      const h = () => handlers.current
      showPage(glassesTexts.starting())
      recording.current = recordSession({ startedAt: t0.current, onAudio: (level) => h().onAudio(level) })
      recording.current.catch(() => {})
      const socket = connectGlassesSocket(
        session.id,
        (message) => h().handleMessage(message),
        () => setSensor((s) => (s.state === 'connecting' ? { ...s, state: 'unavailable' } : s)),
      )
      closeSocket = socket.close

      await wait(2500)
      if (cancelled || finishing.current) return
      setPhase('reading')
      const view = glassesTexts.systemDesignPrompt(prompt)
      await showPage(view)
      if (question) api.markQuestionShown(session.id, question.position, elapsedMs()).catch((err) => console.warn('Prompt timing not saved', err))

      for (let n = COUNTDOWN_FROM; n >= 1; n--) {
        if (cancelled || finishing.current) return
        setLabel(countdownLabel(n))
        await wait(1000)
      }
      setLabel(countdownLabel(0))
      setPhase('explaining')
      await new Promise<void>((resolve) => (doneExplaining.current = resolve))
      if (!cancelled) h().finishExplaining()
    }

    const start = setTimeout(run, 0)
    return () => {
      cancelled = true
      clearTimeout(start)
      clearTimeout(tipTimer.current)
      closeSocket()
      doneExplaining.current?.()
      // Leaving before the explanation was sent: release the mic and close the session.
      if (!finishing.current && recording.current) {
        recording.current.then((rec) => rec.stop()).catch(() => {})
        api.endSession(session.id).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // Elapsed time while explaining, on the phone and in the glasses.
  useEffect(() => {
    if (phase !== 'explaining') return
    const started = performance.now()
    setSeconds(0)
    const tick = setInterval(() => {
      const s = Math.floor((performance.now() - started) / 1000)
      setSeconds(s)
      setLabel(explainingLabel(s))
    }, 1000)
    return () => clearInterval(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Mirror the confirm sheets into the glasses, and restore the page on close.
  useEffect(() => {
    if (confirm) {
      confirming.current = true
      showOnGlasses(confirm === 'end' ? glassesTexts.systemDesignConfirmEnd() : glassesTexts.systemDesignConfirmCancel())
    } else if (confirming.current) {
      confirming.current = false
      showOnGlasses({ ...pageView.current, label: tipTimer.current && tip ? tipLabel(tip) : baseLabel.current })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm])

  // Glasses: press = done explaining; double press = "End the challenge?".
  // On the diagram: first item submits, last item asks to cancel.
  useGlassesInput((input) => {
    if (confirm === 'end') {
      if (input.kind === 'select' && input.index === 1) finishExplaining()
      else if (input.kind === 'select' && input.index === 2) quit()
      else if (input.kind === 'select' || input.kind === 'double') setConfirm(null)
      return
    }
    if (confirm === 'cancel') {
      if (input.kind === 'select' && input.index === 1) cancelAttempt()
      else if (input.kind === 'select' || input.kind === 'double') setConfirm(null)
      return
    }
    if (phase === 'explaining' && input.kind === 'press') endExplaining()
    else if ((phase === 'reading' || phase === 'explaining') && input.kind === 'double') setConfirm('end')
    else if (phase === 'review' && input.kind === 'select' && graph) {
      if (input.index === 0) submit()
      else if (input.index === graph.nodes.length + 1) setConfirm('cancel')
    }
  })

  const endExplaining = () => doneExplaining.current?.()
  const inGlasses = phase === 'reading' || phase === 'explaining'

  if (phase === 'drawing' || phase === 'submitting' || phase === 'failed') {
    return (
      <main className="screen stripes center" style={{ justifyContent: 'center', gap: 16 }}>
        <Mocky size={120} className="in" />
        <h1 className="h1">{phase === 'submitting' ? 'Submitting your design' : phase === 'drawing' ? 'Drawing your design' : "That didn't work"}</h1>
        {phase === 'failed' ? (
          <>
            <p className="error" role="alert" style={{ textAlign: 'center' }}>{error}</p>
            {pending.current && <button className="btn" style={{ background: 'var(--aurora)' }} onClick={upload}>Try again</button>}
            {!pending.current && uploaded.current && (
              <button className="btn" style={{ background: 'var(--aurora)' }} onClick={() => { finishing.current = true; setPhase('drawing'); waitForDiagram() }}>
                Check again
              </button>
            )}
            <button className="btn ghost" onClick={() => nav({ name: 'home' })}>Back home</button>
          </>
        ) : (
          <p className="muted" style={{ textAlign: 'center' }}>
            {phase === 'drawing'
              ? <>Mocky is turning your explanation into an architecture diagram.<br />This takes a few seconds.</>
              : 'Mocky is grading your design.'}
          </p>
        )}
      </main>
    )
  }

  if (phase === 'review' && graph) {
    return (
      <main className="screen" style={{ gap: 16 }}>
        <header className="stack" style={{ gap: 2 }}>
          <span className="eyebrow" style={{ color: 'var(--aurora)' }}>Your design · {company.name}</span>
          <h1 className="h2" style={{ fontSize: 24 }}>Does this match what you said?</h1>
          <p className="muted" style={{ fontSize: 14 }}>"{prompt}"</p>
        </header>

        <section className="card">
          <DiagramView graph={graph} />
        </section>

        <p className="small">You get one attempt. Submit to get graded, or cancel to start over from home.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="stack" style={{ gap: 10 }}>
          <button className="btn" style={{ background: 'var(--aurora)' }} onClick={submit}>Submit for grading</button>
          <button className="btn ghost" onClick={() => setConfirm('cancel')}>Cancel attempt</button>
        </div>

        {confirm === 'cancel' && (
          <div className="scrim" onClick={() => setConfirm(null)}>
            <div className="sheet rise stack" style={{ gap: 12, paddingTop: 24 }} onClick={(e) => e.stopPropagation()}>
              <h2 className="h2">Cancel this attempt?</h2>
              <p className="muted">This challenge has one attempt. Cancelling ends it without a grade.</p>
              <button className="btn" style={{ background: 'var(--bad)' }} onClick={cancelAttempt}>Cancel attempt</button>
              <button className="btn ghost" onClick={() => setConfirm(null)}>Keep my design</button>
            </div>
          </div>
        )}
      </main>
    )
  }

  const status = tip
    ? { title: tip, body: 'Mocky noticed your heart rate rising.' }
    : phase === 'starting'
      ? { title: 'Mocky is with you', body: 'Get comfortable. The challenge is coming.' }
      : phase === 'reading'
        ? { title: 'The challenge is in your glasses', body: 'Read it, then start explaining after GO.' }
        : { title: 'Explain your design', body: 'Think out loud, pauses are fine. When you finish, tap the button or press your glasses.' }

  return (
    <main className="screen stripes" style={{ gap: 14 }}>
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="eyebrow" style={{ color: 'var(--aurora)' }}>System design</span>
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
            {sensor.state === 'online' ? 'Watch connected' : sensor.state === 'offline' ? 'Watch offline' : sensor.state === 'unavailable' ? 'Live link down' : 'Connecting…'}
          </span>
        </div>

        <div className={`card tile ${inGlasses ? 'design' : ''}`}>
          {inGlasses && <div style={{ position: 'absolute', left: 14, top: 16 }}>{icons.glasses('#8E52FF')}</div>}
          <Mocky key={inGlasses ? 'up' : 'down'} size={92} className={inGlasses ? 'out' : 'in'} style={{ position: 'absolute', right: 6, top: 6, transform: 'rotate(-20deg)' }} />
          <div className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{inGlasses ? 'In your glasses' : 'Live mocky view'}</span>
            <span className="dot live" style={{ width: 9, height: 9 }} />
          </div>
        </div>
      </section>

      {phase !== 'starting' && (
        <section className="card stack" style={{ gap: 6 }}>
          <span className="eyebrow" style={{ color: 'var(--aurora)' }}>The challenge</span>
          <p style={{ fontWeight: 700, fontSize: 16, lineHeight: '22px' }}>{prompt}</p>
        </section>
      )}

      <section className="card stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Your voice</span>
          <span style={{ fontWeight: 600, fontSize: 12, color: phase === 'explaining' ? 'var(--aurora)' : 'var(--ink-3)' }}>
            {phase === 'explaining' ? `Listening · ${formatTime(seconds)}` : 'Recording'}
          </span>
        </div>
        <div style={{ opacity: phase === 'explaining' ? 1 : 0.35, transition: 'opacity 0.3s ease' }}>
          <Bars levels={levels} color="#8E52FF" height={80} />
        </div>
      </section>

      {phase === 'explaining' && (
        <button className="btn" style={{ background: 'var(--aurora)' }} onClick={endExplaining}>
          I'm done explaining
        </button>
      )}

      <section className="row" style={{ gap: 12, paddingTop: 4 }}>
        <div className="stack rise" key={status.title} style={{ flex: 1, gap: 2 }}>
          <span className="display" style={{ fontSize: 18, color: tip ? 'var(--bad-ink)' : undefined }}>{status.title}</span>
          <span className="small" style={{ fontSize: 14 }}>{status.body}</span>
        </div>
        <button className="pill" onClick={() => setConfirm('end')}>End</button>
      </section>

      {confirm === 'end' && (
        <div className="scrim" onClick={() => setConfirm(null)}>
          <div className="sheet rise stack" style={{ gap: 12, paddingTop: 24 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="h2">End the challenge?</h2>
            <p className="muted">Mocky can draw a diagram from what you've said so far, or you can quit without a grade.</p>
            <button className="btn" style={{ background: 'var(--aurora)' }} onClick={finishExplaining}>Draw my diagram now</button>
            <button className="btn ghost" onClick={quit} style={{ color: 'var(--bad-ink)' }}>Quit challenge</button>
            <button className="btn ghost" onClick={() => setConfirm(null)}>Keep explaining</button>
          </div>
        </div>
      )}
    </main>
  )
}
