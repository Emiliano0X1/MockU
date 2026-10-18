import { API_URL, USE_MOCK, endpoints } from './config'
import { mockGlassesSocket } from './mock'
import type { GlassesMessage, GlassesReply } from './types'

export type GlassesSocket = { close: () => void }

// Connects to the server's live channel for a recording session. Answers
// pings and acknowledges suggestions; everything else goes to onMessage.
export function connectGlassesSocket(
  sessionId: string,
  onMessage: (message: GlassesMessage) => void,
  onDisconnect?: () => void,
): GlassesSocket {
  if (USE_MOCK) return mockGlassesSocket(onMessage)

  const url = new URL(API_URL + endpoints.glassesSocket(sessionId))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  let closedByUs = false
  const socket = new WebSocket(url)
  // DEBUG: live socket lifecycle.
  console.log(`[live] connecting to ${url}`)
  socket.onopen = () => console.log('[live] socket open')
  const reply = (message: GlassesReply) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  socket.onmessage = (event) => {
    let message: GlassesMessage
    try {
      message = JSON.parse(event.data)
    } catch {
      console.warn('Ignoring malformed live message', event.data)
      return
    }
    if (message.type === 'ping') return reply({ type: 'pong' })
    if (message.type === 'suggestion') reply({ type: 'ack', suggestion_id: message.id })
    onMessage(message)
  }
  socket.onclose = (event) => {
    console.log(`[live] socket closed (code ${event.code}${event.reason ? `, ${event.reason}` : ''})${closedByUs ? ' by the app' : ''}`)
    if (!closedByUs) onDisconnect?.()
  }

  return {
    close() {
      closedByUs = true
      socket.close()
    },
  }
}
