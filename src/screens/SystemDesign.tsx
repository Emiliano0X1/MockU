import { useCallback, useEffect, useRef, useState } from 'react'
import type { Nav } from '../App'
import { api, errorMessage } from '../api/client'
import { connectGlassesSocket } from '../api/live'
import type { Company, GlassesMessage, SessionCreated, SystemDesignDiagramResponse } from '../api/types'
import { Bars, formatTime, icons, Mocky } from '../components/ui'
import { showOnGlasses, type GlassesView } from '../glasses/bridge'
import { useGlassesInput } from '../glasses/input'
import { recordSession, type SessionRecording } from '../glasses/recorder'
import { glassesTexts } from '../glasses/texts'

type Phase = 'briefing' | 'recording' | 'interpreting' | 'review' | 'grading' | 'failed'
type Sensor = { state: 'connecting' | 'online' | 'offline'; lastBpm: number | null }

const LEVEL_HISTORY = 96

export function SystemDesign({
  session,
  company,
  nav,
}: {
  session: SessionCreated
  company: Company
  nav: Nav
}) {
  const [phase, setPhase] = useState<Phase>('briefing')
  const [sensor, setSensor] = useState<Sensor>({ state: 'connecting', lastBpm: null })
  const [tip, setTip] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>(() => new Array(LEVEL_HISTORY).fill(0.02))
  const [error, setError] = useState('')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [diagram, setDiagram] = useState<SystemDesignDiagramResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const promptText = session.questions[0]?.text ?? 'Design a distributed system'
  const recording = useRef<Promise<SessionRecording> | null>(null)
  const activeSession = useRef(true)


  // Glasses HUD sync
  const showView = useCallback((view: GlassesView) => {
    showOnGlasses(view).catch(() => {})
  }, [])

  // Connect WebSocket for live biometric updates
  useEffect(() => {
    activeSession.current = true
    const socket = connectGlassesSocket(
      session.id,
      (msg: GlassesMessage) => {
        if (!activeSession.current) return
        if (msg.type === 'sensor_status') {
          setSensor({ state: msg.state, lastBpm: msg.last_bpm })
        } else if (msg.type === 'suggestion') {
          setTip(msg.text)
          setTimeout(() => setTip(null), msg.ttl_ms)
        } else if (msg.type === 'diagram_ready') {
          loadDiagram()
        }
      },
      () => setSensor({ state: 'offline', lastBpm: null }),
    )
    return () => {
      activeSession.current = false
      socket.close()
    }
  }, [session.id])

  // Glasses input controls
  useGlassesInput((input) => {
    if (phase === 'briefing' && input.kind === 'press') {
      startRecording()
    } else if (phase === 'recording' && input.kind === 'press') {
      stopRecording()
    } else if (phase === 'review' && input.kind === 'double') {
      acceptDiagram()
    }
  })

  // Briefing initial view on glasses
  useEffect(() => {
    if (phase === 'briefing') {
      showView(glassesTexts.systemDesignPrompt(promptText))
    }
  }, [phase, promptText, showView])

  // Recording timer
  useEffect(() => {
    if (phase !== 'recording') return
    const timer = setInterval(() => {
      setRecordingSeconds((s) => s + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [phase])

  // Start candidate recording
  const startRecording = async () => {
    setError('')
    try {
      const recPromise = recordSession({
        startedAt: performance.now(),
        onAudio: (level: number) => {
          setLevels((prev) => [...prev.slice(1), Math.min(1, Math.max(0.02, level))])
        },
      })
      recording.current = recPromise
      setPhase('recording')
      showView(glassesTexts.systemDesignPrompt(promptText))
    } catch (err) {
      setError(errorMessage(err, 'Microphone could not be started.'))
    }
  }


  // Stop recording and submit attempt audio
  const stopRecording = async () => {
    if (!recording.current) return
    setPhase('interpreting')
    showView(glassesTexts.systemDesignInterpreting())
    try {
      const { wav, durationMs } = await (await recording.current).stop()
      await api.uploadSystemDesignAttempt(session.id, wav, durationMs, 1)
      pollForDiagram()
    } catch (err) {
      setError(errorMessage(err, 'Failed to upload attempt audio.'))
      setPhase('failed')
    }
  }

  // Poll until diagram is ready
  const pollForDiagram = useCallback(async () => {
    let attempts = 0
    const maxAttempts = 30
    const interval = setInterval(async () => {
      attempts++
      try {
        const diag = await api.getSystemDesignDiagram(session.id)
        if (diag.status === 'ready' && diag.graph) {
          clearInterval(interval)
          setDiagram(diag)
          setPhase('review')
          const summaryList = diag.glasses_summary?.components ?? []
          showView(glassesTexts.systemDesignReview(summaryList.length, summaryList))
        } else if (diag.status === 'failed' || attempts >= maxAttempts) {
          clearInterval(interval)
          setError('Could not interpret diagram in time.')
          setPhase('failed')
        }
      } catch (err) {
        if (attempts >= maxAttempts) {
          clearInterval(interval)
          setError(errorMessage(err, 'Failed to retrieve diagram.'))
          setPhase('failed')
        }
      }
    }, 2000)
  }, [session.id, showView])

  const loadDiagram = async () => {
    try {
      const diag = await api.getSystemDesignDiagram(session.id)
      if (diag.status === 'ready' && diag.graph) {
        setDiagram(diag)
        setPhase('review')
        const summaryList = diag.glasses_summary?.components ?? []
        showView(glassesTexts.systemDesignReview(summaryList.length, summaryList))
      }
    } catch {
      // ignore
    }
  }

  // Accept diagram for grading
  const acceptDiagram = async () => {
    setSubmitting(true)
    setPhase('grading')
    showView(glassesTexts.systemDesignGrading())
    try {
      await api.acceptSystemDesignDiagram(session.id, 1)
      // Poll report status until complete
      pollForReport()
    } catch (err) {
      setError(errorMessage(err, 'Failed to submit diagram for grading.'))
      setSubmitting(false)
      setPhase('review')
    }
  }

  // Reject / Cancel diagram attempt
  const rejectDiagram = async () => {
    if (!confirm('Cancel this attempt? System design practice only allows 1 attempt.')) return
    try {
      await api.rejectSystemDesignDiagram(session.id, 1, 'Candidate cancelled')
      nav({ name: 'home' })
    } catch (err) {
      setError(errorMessage(err, 'Could not cancel attempt.'))
    }
  }

  const pollForReport = useCallback(async () => {
    const timer = setInterval(async () => {
      try {
        const rep = await api.getReport(session.id)
        if (rep.status === 'done') {
          clearInterval(timer)
          nav({ name: 'results', sessionId: session.id })
        }
      } catch {
        // keep polling
      }
    }, 2500)
  }, [session.id, nav])

  return (
    <main className="screen stripes" style={{ paddingBottom: 32 }}>
      {/* Top Header */}
      <header className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="pill" style={{ fontWeight: 700 }}>
          {company.name} · System Design
        </span>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className={`dot ${sensor.state === 'online' ? 'on' : ''}`} />
          <span className="small">
            {sensor.state === 'online' && sensor.lastBpm ? `❤️ ${sensor.lastBpm} bpm` : 'Sensor off'}
          </span>
        </div>
      </header>

      {/* Tip Banner */}
      {tip && (
        <div className="chip rise" style={{ background: 'var(--brand)', color: 'white', marginTop: 12 }}>
          {tip}
        </div>
      )}

      {/* Content By Phase */}
      {phase === 'briefing' && (
        <section className="card rise" style={{ marginTop: 20, gap: 16 }}>
          <div className="stack" style={{ gap: 6 }}>
            <span className="tag">System Design Challenge</span>
            <h1 className="h1">{promptText}</h1>
            <p className="muted">
              Explain your architectural approach out loud: components, data flow, storage,
              caching, scaling strategies, and trade-offs. Mocky will generate a structured diagram from your speech.
            </p>
          </div>

          <div className="card inset stack" style={{ gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>💡 Tips for a High Score</span>
            <ul className="small stack" style={{ gap: 4, paddingLeft: 18 }}>
              <li>Identify functional and non-functional requirements (read vs. write scale).</li>
              <li>Outline the main data models and storage engine choice.</li>
              <li>Explain caching (e.g. Redis), queues (Kafka), and worker decoupling.</li>
              <li>Address single points of failure and database replication.</li>
            </ul>
          </div>

          <button className="btn" onClick={startRecording} style={{ marginTop: 8 }}>
            {icons.bigPlay} Start Recording Explanation
          </button>
        </section>
      )}

      {phase === 'recording' && (
        <section className="card rise center" style={{ marginTop: 24, gap: 20, textAlign: 'center' }}>
          <div className="stack" style={{ gap: 8 }}>
            <span className="tag" style={{ alignSelf: 'center' }}>Live Recording</span>
            <h2 className="h2">{promptText}</h2>
            <span className="mono" style={{ fontSize: 32, fontWeight: 800 }}>
              {formatTime(recordingSeconds)}
            </span>
          </div>

          <div style={{ width: '100%', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bars levels={levels} color="#4C82F7" height={40} />
          </div>


          <p className="small muted">
            Speaking into microphone… Explain components, APIs, databases, and trade-offs.
          </p>

          <button className="btn" onClick={stopRecording} style={{ background: 'var(--accent)' }}>
            I'm Done · Generate Diagram
          </button>
        </section>
      )}

      {phase === 'interpreting' && (
        <section className="card rise center" style={{ marginTop: 40, gap: 16, textAlign: 'center', padding: 32 }}>
          <Mocky size={80} />
          <h2 className="h2">Interpreting Architecture…</h2>
          <p className="muted small" style={{ maxWidth: 320 }}>
            Mocky is transcribing your explanation and extracting an architectural component graph.
            This takes about 10–15 seconds.
          </p>
        </section>
      )}

      {phase === 'review' && diagram && diagram.graph && (
        <section className="stack rise" style={{ marginTop: 16, gap: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <span className="tag">Generated Architecture</span>
              <h2 className="h2" style={{ marginTop: 4 }}>Review Your Diagram</h2>
            </div>
            <span className="small muted">Attempt 1 of 1</span>
          </div>

          {/* Interactive Graph Component Canvas */}
          <div className="card inset stack" style={{ gap: 14 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>
              Architecture Components ({diagram.graph.nodes.length})
            </span>
            <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {diagram.graph.nodes.map((node) => (
                <div
                  key={node.id}
                  className="card"
                  style={{
                    padding: 10,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                >
                  <span className="pill" style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4, display: 'inline-block' }}>
                    {node.type.replace('_', ' ')}
                  </span>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{node.label}</div>
                  {node.description && (
                    <p className="small muted" style={{ fontSize: 11, marginTop: 4 }}>
                      {node.description}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <span style={{ fontWeight: 700, fontSize: 13, marginTop: 8 }}>
              Data Flow Connections ({diagram.graph.edges.length})
            </span>
            <div className="stack" style={{ gap: 6 }}>
              {diagram.graph.edges.map((edge) => (
                <div
                  key={edge.id}
                  className="row small"
                  style={{ justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg)', borderRadius: 6 }}
                >
                  <span>
                    <strong>{edge.source.replace('node_', '')}</strong> ➔ <strong>{edge.target.replace('node_', '')}</strong>
                  </span>
                  <span className="muted">{edge.label || edge.protocol || 'connects'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Accept / Cancel Controls */}
          <div className="row" style={{ gap: 12, marginTop: 8 }}>
            <button
              className="btn"
              onClick={acceptDiagram}
              disabled={submitting}
              style={{ flex: 2 }}
            >
              {submitting ? 'Submitting…' : 'Accept & Submit for Grading'}
            </button>
            <button
              className="btn ghost"
              onClick={rejectDiagram}
              disabled={submitting}
              style={{ flex: 1, color: 'var(--bad-ink)' }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {phase === 'grading' && (
        <section className="card rise center" style={{ marginTop: 40, gap: 16, textAlign: 'center', padding: 32 }}>
          <Mocky size={80} />
          <h2 className="h2">Grading Your Design…</h2>
          <p className="muted small" style={{ maxWidth: 320 }}>
            Mocky is analyzing your transcript, components, trade-offs, and biometric composure
            against the prompt rubric.
          </p>
        </section>
      )}

      {error && (
        <p className="error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}
    </main>
  )
}
