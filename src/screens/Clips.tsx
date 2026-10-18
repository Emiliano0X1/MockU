import { useEffect, useMemo, useRef, useState } from 'react'
import type { Nav } from '../App'
import type { Clip, SignalKey, TranscriptPart } from '../api/types'
import { BackButton, Bars, formatTime, icons, Mocky, seededLevels } from '../components/ui'
import { useResult } from './useResult'

const signalNames: Record<SignalKey, string> = {
  pauses: 'Long pause',
  fillers: 'Filler words',
  restarts: 'Restarts',
  voice: 'Voice',
  pace: 'Pace',
  off_topic: 'Off-topic',
}

const markColor = (signal: SignalKey) => (signal === 'pauses' || signal === 'fillers' ? '#E5484D' : '#F5A524')

export function Clips({ resultId, clipId, nav }: { resultId: string; clipId?: string; nav: Nav }) {
  const { result } = useResult(resultId)
  const clips = result?.clips ?? []
  const [index, setIndex] = useState(() => Math.max(0, clips.findIndex((clip) => clip.id === clipId)))
  const clip = clips[index]

  if (!result || !clip) {
    return (
      <main className="screen center" style={{ justifyContent: 'center' }}>
        <Mocky size={96} />
      </main>
    )
  }

  const upNext = clips.filter((_, i) => i !== index)

  return (
    <main className="screen">
      <header className="row" style={{ gap: 12, paddingBottom: 14 }}>
        <BackButton onClick={() => nav({ name: 'results', resultId })} />
        <h1 className="h2" style={{ flex: 1 }}>Weak clips</h1>
      </header>

      <Player key={clip.id} clip={clip} />

      <section className="stack" style={{ gap: 8, paddingTop: 20 }}>
        <h2 className="eyebrow">What you said</h2>
        <Transcript parts={clip.transcript} />
      </section>

      <section className="row" style={{ alignItems: 'flex-start', gap: 10, paddingTop: 20 }}>
        <Mocky size={52} style={{ flexShrink: 0 }} />
        <div className="coach">
          <span className="eyebrow" style={{ color: 'var(--sky)' }}>Try this instead</span>
          <p style={{ fontWeight: 600, fontSize: 15, lineHeight: '21px' }}>{clip.suggestion}</p>
        </div>
      </section>

      {upNext.length > 0 && (
        <section className="stack" style={{ paddingTop: 22 }}>
          <h2 className="eyebrow" style={{ paddingBottom: 4 }}>Up next</h2>
          {upNext.map((other) => (
            <button key={other.id} className="list-row" onClick={() => setIndex(clips.indexOf(other))}>
              <span className={`tag ${markColor(other.signal) === '#E5484D' ? 'bad' : 'warn'}`} style={{ width: 84, textAlign: 'center', fontSize: 12, fontWeight: 700, lineHeight: '20px', flexShrink: 0 }}>
                {signalNames[other.signal]}
              </span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>"{other.questionText}"</span>
              <span className="small" style={{ width: 36, textAlign: 'right', flexShrink: 0 }}>{formatTime(other.durationSeconds)}</span>
            </button>
          ))}
        </section>
      )}
    </main>
  )
}

function Player({ clip }: { clip: Clip }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const levels = useMemo(() => seededLevels(clip.id, 100), [clip.id])
  const firstMark = clip.marks[0]

  // Without an audio URL (mock mode) the playhead still moves so the flow can be demoed.
  useEffect(() => {
    if (!playing || clip.audioUrl) return
    const tick = setInterval(() => {
      setTime((t) => {
        if (t + 0.25 >= clip.durationSeconds) {
          setPlaying(false)
          return clip.durationSeconds
        }
        return t + 0.25
      })
    }, 250)
    return () => clearInterval(tick)
  }, [playing, clip])

  const toggle = () => {
    const element = audio.current
    if (clip.audioUrl && element) {
      if (playing) element.pause()
      else element.play()
    }
    if (!playing && time >= clip.durationSeconds) setTime(0)
    setPlaying(!playing)
  }

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const next = ((event.clientX - rect.left) / rect.width) * clip.durationSeconds
    setTime(next)
    if (audio.current) audio.current.currentTime = next
  }

  return (
    <section className="player">
      {clip.audioUrl && (
        <audio
          ref={audio}
          src={clip.audioUrl}
          preload="metadata"
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <div className="stack" style={{ gap: 4 }}>
        <span className="eyebrow" style={{ color: markColor(clip.signal) }}>{signalNames[clip.signal]}</span>
        <p style={{ fontWeight: 600, fontSize: 16, lineHeight: '22px' }}>"{clip.questionText}"</p>
      </div>
      <div style={{ position: 'relative', height: 84, cursor: 'pointer' }} onClick={seek}>
        {clip.marks.map((mark) => (
          <div
            key={mark.start}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${(mark.start / clip.durationSeconds) * 100}%`,
              width: `${((mark.end - mark.start) / clip.durationSeconds) * 100}%`,
              background: markColor(mark.signal),
              opacity: 0.25,
              borderRadius: 6,
            }}
          />
        ))}
        <Bars levels={levels} color="#9DB8FF" height={84} />
        <div style={{ position: 'absolute', top: -4, bottom: -4, width: 3, borderRadius: 2, background: '#fff', left: `${(time / clip.durationSeconds) * 100}%` }} />
      </div>
      <div className="row" style={{ gap: 14 }}>
        <button
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--sky)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          {playing ? icons.pause : icons.play('#fff')}
        </button>
        {firstMark && (
          <button
            className="small"
            style={{ color: '#C9D1DC', flex: 1, textAlign: 'left' }}
            onClick={() => {
              setTime(firstMark.start)
              if (audio.current) audio.current.currentTime = firstMark.start
            }}
          >
            Jump to {firstMark.label.toLowerCase()}
          </button>
        )}
        <span style={{ fontWeight: 700, fontSize: 13, marginLeft: 'auto' }}>
          {formatTime(time)} / {formatTime(clip.durationSeconds)}
        </span>
      </div>
    </section>
  )
}

function Transcript({ parts }: { parts: TranscriptPart[] }) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: '4px 5px' }}>
      {parts.map((part, i) =>
        !part.tag ? (
          <span key={i} style={{ fontSize: 16, lineHeight: '24px' }}>{part.text}</span>
        ) : part.tag === 'drift' || part.tag === 'pace' || part.tag === 'voice' ? (
          <span key={i} className="tag warn">{part.text}</span>
        ) : (
          <span key={i} className="tag bad">{part.tag === 'pause' ? `⏸ ${part.text}` : part.text}</span>
        ),
      )}
    </div>
  )
}
