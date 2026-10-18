import { getToken } from './client'
import { API_URL, USE_MOCK, endpoints } from './config'
import { mockLive } from './mock'
import type { LiveCommand, LiveEvent } from './types'

export type LiveConnection = {
  send: (command: LiveCommand) => void
  close: () => void
}

export function connectLive(interviewId: string, onEvent: (event: LiveEvent) => void): LiveConnection {
  if (USE_MOCK) return mockLive(onEvent)

  const url = new URL(API_URL + endpoints.live(interviewId))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = getToken()
  if (token) url.searchParams.set('token', token)

  const socket = new WebSocket(url)
  const queue: LiveCommand[] = []

  socket.onopen = () => {
    for (const command of queue.splice(0)) socket.send(JSON.stringify(command))
  }
  socket.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as LiveEvent)
    } catch {
      console.warn('Ignoring malformed live event', message.data)
    }
  }
  socket.onerror = () => onEvent({ type: 'error', message: 'Lost connection to the interview server.' })

  return {
    send(command) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command))
      else queue.push(command)
    },
    close: () => socket.close(),
  }
}
