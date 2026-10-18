import { AudioInputSource } from '@evenrealities/even_hub_sdk'
import { MIC_SAMPLE_RATE, SILENCE_RMS_THRESHOLD } from '../api/config'
import { ensureGlassesPage, getBridge } from './bridge'

const BYTES_PER_MS = (MIC_SAMPLE_RATE * 2) / 1000 // 16-bit mono

export type SessionRecording = {
  // Stops the mic and returns the whole interview as one WAV.
  stop: () => Promise<{ wav: Blob; durationMs: number }>
}

type Options = {
  // performance.now() at the session's t = 0. The audio is padded with
  // silence at the start so its timeline matches the server's *_ms values.
  startedAt: number
  // Called for every audio frame: 0..1 loudness for the waveform, and
  // whether the frame is loud enough to count as speech.
  onAudio: (level: number, speech: boolean) => void
}

// Records the glasses mic for the whole interview. Outside the Even App it
// simulates speech and returns a silent WAV of the same length.
export async function recordSession({ startedAt, onAudio }: Options): Promise<SessionRecording> {
  const bridge = await getBridge()
  if (!bridge) return simulate({ startedAt, onAudio })

  await ensureGlassesPage()
  const chunks: Uint8Array[] = []
  let bytes = 0
  let stopped = false

  const unsubscribe = bridge.onEvenHubEvent((event) => {
    const audio = event.audioEvent
    if (!audio || stopped) return
    if (chunks.length === 0) {
      // Silence for the time between t = 0 and the start of this first frame.
      const gapMs = performance.now() - startedAt - audio.audioPcm.byteLength / BYTES_PER_MS
      const padding = new Uint8Array(Math.max(0, Math.floor(gapMs * BYTES_PER_MS)) & ~1)
      chunks.push(padding)
      bytes += padding.byteLength
    }
    chunks.push(audio.audioPcm.slice())
    bytes += audio.audioPcm.byteLength

    const rms = rmsOf(audio.audioPcm)
    onAudio(Math.min(1, rms / (SILENCE_RMS_THRESHOLD * 6)), rms >= SILENCE_RMS_THRESHOLD)
  })

  await bridge.audioControl(true, AudioInputSource.Glasses)

  return {
    async stop() {
      if (!stopped) {
        stopped = true
        unsubscribe()
        await bridge.audioControl(false)
      }
      return { wav: toWav(chunks, bytes), durationMs: bytes / BYTES_PER_MS }
    },
  }
}

function rmsOf(pcm: Uint8Array) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2))
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

// 16-bit mono PCM wrapped in a WAV header so the server can read it directly.
function toWav(chunks: Uint8Array[], dataLength: number): Blob {
  const header = new DataView(new ArrayBuffer(44))
  const writeString = (offset: number, text: string) =>
    [...text].forEach((char, i) => header.setUint8(offset + i, char.charCodeAt(0)))
  writeString(0, 'RIFF')
  header.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, 1, true) // mono
  header.setUint32(24, MIC_SAMPLE_RATE, true)
  header.setUint32(28, MIC_SAMPLE_RATE * 2, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  writeString(36, 'data')
  header.setUint32(40, dataLength, true)
  return new Blob([header.buffer, ...chunks.map((chunk) => chunk.slice())], { type: 'audio/wav' })
}

// Browser preview: alternates ~7s of "speech" with silence so answers end on
// their own, and produces a silent WAV as long as the session.
function simulate({ startedAt, onAudio }: Options): SessionRecording {
  const timer = setInterval(() => {
    const speaking = (performance.now() - startedAt) % 15000 < 7000
    onAudio(speaking ? 0.15 + Math.random() * 0.75 : 0.02, speaking)
  }, 120)
  return {
    async stop() {
      clearInterval(timer)
      onAudio(0, false)
      const durationMs = performance.now() - startedAt
      // Keep the preview upload small: a short silent clip, real duration.
      const bytes = Math.floor(Math.min(durationMs, 2000) * BYTES_PER_MS) & ~1
      return { wav: toWav([new Uint8Array(bytes)], bytes), durationMs }
    },
  }
}
