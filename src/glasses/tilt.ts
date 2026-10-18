import { ImuReportPace, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { ensureGlassesPage, getBridge } from './bridge'

// The SDK reports IMU x/y/z as accelerometer readings in g (the vector is ~1.0
// long at rest), so a head tilt shifts gravity between axes. Tune these with
// the live readout on the "Test glasses texts" screen.
export const TILT = {
  axis: 'x' as 'x' | 'y' | 'z', // the axis that moves when the head tilts left/right
  mode: 'angle' as 'angle' | 'rate', // 'rate' integrates the readings into an angle
  threshold: 0.25, // readings are in g (gravity ~1.0 total); 0.25 is roughly a 15° tilt
  invert: false, // flip if tilting left is detected as right
  holdMs: 1000, // how long a tilt must be held to choose
  calibrationSamples: 8, // readings averaged as the resting position
}

export type Side = 'left' | 'right'
export type ImuSample = { x: number; y: number; z: number }

type Handlers = {
  onLean?: (side: Side | null, progress: number) => void // progress 0..1 while holding
  onChoose: (side: Side) => void
}

// Starts IMU reporting and calls onChoose when a tilt is held. Returns a stop
// function. Does nothing outside the Even App.
export async function watchTilt({ onLean, onChoose }: Handlers): Promise<() => void> {
  const detector = createDetector({ onLean, onChoose })
  detectors.add(detector)
  const stop = await watchImu(detector.onSample)
  return () => {
    detectors.delete(detector)
    stop()
  }
}

const detectors = new Set<ReturnType<typeof createDetector>>()

// Takes the current head position as the new resting position for every
// active tilt watcher. Hold your head straight while the next readings arrive.
export function recalibrateTilt() {
  detectors.forEach((detector) => detector.recalibrate())
}

// The IMU is one switch shared by every watcher. It stays on while anyone is
// listening, and on/off calls run in order, so a stale "off" from an earlier
// watcher (e.g. React StrictMode's mount/unmount/mount) can't switch it off
// under a newer one.
const listeners = new Set<(sample: ImuSample) => void>()
// What the host actually does, for the readout on the glasses test screen.
export const imuDebug = { controlResult: null as boolean | null, events: 0, imuEvents: 0, lastEvent: '' }
let subscribed = false
let imuOn = false
let imuSync: Promise<void> = Promise.resolve()

function syncImu(bridge: EvenAppBridge) {
  imuSync = imuSync
    .then(async () => {
      const want = listeners.size > 0
      if (want === imuOn) return
      imuOn = want
      if (want) {
        await ensureGlassesPage()
        imuDebug.controlResult = await bridge.imuControl(true, ImuReportPace.P100)
      } else {
        imuDebug.controlResult = await bridge.imuControl(false)
      }
    })
    .catch((error) => console.error('IMU control failed', error))
  return imuSync
}

export async function watchImu(onSample: (sample: ImuSample) => void): Promise<() => void> {
  const bridge = await getBridge()
  if (!bridge) return () => {}
  if (!subscribed) {
    subscribed = true
    bridge.onEvenHubEvent((event) => {
      imuDebug.events++
      if (!event.audioEvent) imuDebug.lastEvent = safeJson(event)
      const sys = event.sysEvent
      // Accept imuData even if eventType arrives missing or mislabeled.
      if (!sys?.imuData) return
      imuDebug.imuEvents++
      const sample = { x: sys.imuData.x ?? 0, y: sys.imuData.y ?? 0, z: sys.imuData.z ?? 0 }
      listeners.forEach((listener) => listener(sample))
    })
  }
  // Wrap so two watchers passing the same function (e.g. a state setter under
  // StrictMode) get separate entries and one stopping can't remove the other.
  const listener = (sample: ImuSample) => onSample(sample)
  listeners.add(listener)
  await syncImu(bridge)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    listeners.delete(listener)
    syncImu(bridge)
  }
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 400)
  } catch {
    return String(value)
  }
}

function createDetector({ onLean, onChoose }: Handlers) {
  const calibration: number[] = []
  let rest = 0
  let angle = 0
  let lastTime = 0
  let leaning: Side | null = null
  let leanStart = 0
  let waitForNeutral = false

  const recalibrate = () => {
    calibration.length = 0
    angle = 0
    waitForNeutral = false
    if (leaning) onLean?.(null, 0)
    leaning = null
  }

  const onSample = (sample: ImuSample) => {
    const value = sample[TILT.axis]
    const now = performance.now()

    if (calibration.length < TILT.calibrationSamples) {
      calibration.push(value)
      rest = calibration.reduce((a, b) => a + b, 0) / calibration.length
      lastTime = now
      return
    }

    let offset: number
    if (TILT.mode === 'rate') {
      angle += (value - rest) * ((now - lastTime) / 1000)
      offset = angle
    } else {
      offset = value - rest
    }
    lastTime = now
    if (TILT.invert) offset = -offset

    const side: Side | null = offset > TILT.threshold ? 'right' : offset < -TILT.threshold ? 'left' : null

    if (side === null) {
      waitForNeutral = false
      if (leaning) onLean?.(null, 0)
      leaning = null
      return
    }
    if (waitForNeutral) return
    if (side !== leaning) {
      leaning = side
      leanStart = now
    }
    const progress = Math.min(1, (now - leanStart) / TILT.holdMs)
    onLean?.(side, progress)
    if (progress >= 1) {
      waitForNeutral = true
      leaning = null
      if (TILT.mode === 'rate') angle = 0
      onChoose(side)
    }
  }

  return { onSample, recalibrate }
}
