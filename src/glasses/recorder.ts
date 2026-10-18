import { AudioInputSource } from '@evenrealities/even_hub_sdk'
import { MIC_SAMPLE_RATE, SILENCE_RMS_THRESHOLD, SILENCE_SECONDS_TO_END } from '../api/config'
import { ensureGlassesPage, getBridge } from './bridge'

export type Recording = {
  stop: () => Promise<Blob>
}

type Options = {
  onLevel: (level: number) => void // 0..1, for the live waveform
  onSilenceEnd: (wav: Blob) => void // the user finished answering
}

// Records one answer from the glasses mic and ends it after a stretch of
// silence that follows speech. Outside the Even App it simulates an answer.
export async function recordAnswer({ onLevel, onSilenceEnd }: Options): Promise<Recording> {
  const bridge = await getBridge()
  if (!bridge) return simulate({ onLevel, onSilenceEnd })

  await ensureGlassesPage()
  const chunks: Uint8Array[] = []
  let heardSpeech = false
  let silentSince: number | null = null
  let finished = false

  const finish = async () => {
    if (finished) return toWav(chunks)
    finished = true
    unsubscribe()
    await bridge.audioControl(false)
    return toWav(chunks)
  }

  const unsubscribe = bridge.onEvenHubEvent((event) => {
    const audio = event.audioEvent
    if (!audio || finished) return
    chunks.push(audio.audioPcm)

    const rms = rmsOf(audio.audioPcm)
    onLevel(Math.min(1, rms / (SILENCE_RMS_THRESHOLD * 6)))
    const now = performance.now()
    if (rms >= SILENCE_RMS_THRESHOLD) {
      heardSpeech = true
      silentSince = null
    } else if (heardSpeech) {
      silentSince ??= now
      if (now - silentSince >= SILENCE_SECONDS_TO_END * 1000) finish().then(onSilenceEnd)
    }
  })

  await bridge.audioControl(true, AudioInputSource.Glasses)
  return { stop: finish }
}

function rmsOf(pcm: Uint8Array) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2))
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

// 16-bit mono PCM wrapped in a WAV header so the server can read it directly.
function toWav(chunks: Uint8Array[]): Blob {
  const dataLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
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

function simulate({ onLevel, onSilenceEnd }: Options): Recording {
  let done = false
  const levels = setInterval(() => onLevel(0.15 + Math.random() * 0.75), 120)
  const end = () => {
    done = true
    clearInterval(levels)
    clearTimeout(timer)
    onLevel(0)
    return Promise.resolve(toWav([]))
  }
  const timer = setTimeout(() => !done && end().then(onSilenceEnd), 8000)
  return { stop: end }
}
