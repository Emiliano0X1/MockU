import { ImuReportPace, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { ensureGlassesPage, getBridge, onGlassesPageChange } from './bridge'

// The SDK reports IMU x/y/z as accelerometer readings in g (the vector is ~1.0
// long at rest). Head roll (ear toward shoulder) is measured as the angle of
// gravity toward `axis`, normalized by the full vector so nodding barely
// affects it. Tune these with the live readout on the "Test glasses texts" screen.
export const TILT = {
  axis: 'y' as 'x' | 'y' | 'z', // the axis that points out of the side of the glasses
  invert: false, // flip if tilting left is detected as right
  enterDegrees: 10, // tilt past this to start choosing
  exitDegrees: 6, // must come back inside this to cancel or choose again
  smoothing: 0.35, // 0..1, weight of each new reading; lower is smoother but slower
  holdMs: 800, // how long a tilt must be held to choose
  calibrationSamples: 6, // readings averaged as the resting position
}

export type Side = 'left' | 'right'
export type ImuSample = { x: number; y: number; z: number }

type Handlers = {
  onLean?: (side: Side | null, progress: number) => void // progress 0..1 while holding
  onChoose: (side: Side) => void
  onAngle?: (degrees: number | null) => void // smoothed roll from rest; null while calibrating
}

// Starts IMU reporting and calls onChoose when a tilt is held. Returns a stop
// function. Does nothing outside the Even App.
export async function watchTilt(handlers: Handlers): Promise<() => void> {
  const detector = createDetector(handlers)
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

function syncImu(bridge: EvenAppBridge, force = false) {
  imuSync = imuSync
    .then(async () => {
      const want = listeners.size > 0
      if (want === imuOn && !(force && want)) return
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
    // A page rebuild may reset IMU reporting on the glasses; turn it back on.
    onGlassesPageChange(() => {
      if (imuOn) syncImu(bridge, true)
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

// Roll in degrees: the angle of gravity toward TILT.axis, independent of how
// strongly the sensor reads and mostly independent of pitch.
function rollDegrees(sample: ImuSample) {
  const magnitude = Math.hypot(sample.x, sample.y, sample.z)
  if (magnitude < 0.1) return null // no usable gravity reading
  const ratio = Math.max(-1, Math.min(1, sample[TILT.axis] / magnitude))
  return (Math.asin(ratio) * 180) / Math.PI
}

function createDetector({ onLean, onChoose, onAngle }: Handlers) {
  const calibration: number[] = []
  let rest = 0
  let smoothed = 0
  let leaning: Side | null = null
  let leanStart = 0
  let waitForNeutral = false

  const cancelLean = () => {
    if (leaning) onLean?.(null, 0)
    leaning = null
  }

  const recalibrate = () => {
    calibration.length = 0
    waitForNeutral = false
    cancelLean()
    onAngle?.(null)
  }

  const onSample = (sample: ImuSample) => {
    const roll = rollDegrees(sample)
    if (roll === null) return
    const now = performance.now()

    if (calibration.length < TILT.calibrationSamples) {
      calibration.push(roll)
      rest = calibration.reduce((a, b) => a + b, 0) / calibration.length
      smoothed = 0
      return
    }

    // Low-pass filter so single noisy readings don't start or cancel a tilt.
    smoothed += ((roll - rest) - smoothed) * TILT.smoothing
    const angle = TILT.invert ? -smoothed : smoothed
    onAngle?.(angle)
    const magnitude = Math.abs(angle)
    const direction: Side = angle < 0 ? 'left' : 'right'

    // Back near center: cancel any hold and allow the next choice.
    if (magnitude < TILT.exitDegrees) {
      waitForNeutral = false
      cancelLean()
      return
    }
    if (waitForNeutral) return

    // Between exit and enter thresholds: keep an ongoing hold, don't start one.
    if (!leaning) {
      if (magnitude < TILT.enterDegrees) return
      leaning = direction
      leanStart = now
    } else if (direction !== leaning) {
      leaning = direction
      leanStart = now
    }

    const progress = Math.min(1, (now - leanStart) / TILT.holdMs)
    onLean?.(leaning, progress)
    if (progress >= 1) {
      const chosen = leaning
      waitForNeutral = true
      leaning = null
      onChoose(chosen)
    }
  }

  return { onSample, recalibrate }
}
