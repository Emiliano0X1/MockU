import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { useEffect, useRef } from 'react'
import { currentGlassesList, getBridge } from './bridge'

// Touchpad / ring gestures, normalized. `select` is a press on a native list
// (see GlassesView.list); swipes inside a list just move its highlight.
export type GlassesInput =
  | { kind: 'press' }
  | { kind: 'double' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'select'; index: number }

type Handler = (input: GlassesInput) => void

// Only the most recently mounted screen receives input.
const stack: Handler[] = []
let subscribed = false

function subscribe() {
  if (subscribed) return
  subscribed = true
  getBridge().then((bridge) => {
    if (!bridge) {
      subscribed = false
      return
    }
    bridge.onEvenHubEvent((event) => {
      const input = normalize(event)
      if (!input) return
      console.log('[glasses] input', input) // DEBUG
      stack[stack.length - 1]?.(input)
    })
  })
}

function normalize(event: EvenHubEvent): GlassesInput | null {
  if (event.audioEvent || event.sysEvent?.imuData) return null

  const list = event.listEvent
  if (list) {
    // 0 is the protobuf default, so CLICK and index 0 can arrive as undefined.
    const type = list.eventType ?? OsEventTypeList.CLICK_EVENT
    if (type === OsEventTypeList.CLICK_EVENT) {
      const byName = list.currentSelectItemName ? currentGlassesList()?.indexOf(list.currentSelectItemName) : -1
      return { kind: 'select', index: list.currentSelectItemIndex ?? (byName != null && byName >= 0 ? byName : 0) }
    }
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) return { kind: 'double' }
    return null
  }

  const press = event.textEvent ?? event.sysEvent
  if (!press) return null
  if (event.sysEvent && !event.textEvent && event.sysEvent.systemExitReasonCode != null) return null
  switch (press.eventType ?? OsEventTypeList.CLICK_EVENT) {
    case OsEventTypeList.CLICK_EVENT:
      return { kind: 'press' }
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return { kind: 'double' }
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return { kind: 'up' }
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return { kind: 'down' }
    default:
      return null
  }
}

// Dev only: drive the app without glasses, e.g. __glasses({ kind: 'select', index: 0 }).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __glasses: Handler }).__glasses = (input) => stack[stack.length - 1]?.(input)
}

// Routes glasses input to this screen while it is mounted. The handler can
// change every render; the latest one is always used.
export function useGlassesInput(handler: Handler) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const entry: Handler = (input) => ref.current(input)
    stack.push(entry)
    subscribe()
    return () => {
      const i = stack.lastIndexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [])
}
