import { API_URL, USE_MOCK, endpoints } from './config'
import { mockApi } from './mock'
import type { HistoryItem, Interview, Result, Session, User } from './types'

const TOKEN_KEY = 'mocku.token'

let token: string | null = readToken()

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(value: string | null) {
  token = value
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable; keep the token in memory only
  }
}

export function getToken() {
  return token
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json')
  const res = await fetch(API_URL + path, { ...init, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

const realApi = {
  signUp: (name: string, email: string, password: string) =>
    request<Session>(endpoints.signUp, { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  signIn: (email: string, password: string) =>
    request<Session>(endpoints.signIn, { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request<User>(endpoints.me),
  uploadResume: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<User>(endpoints.resume, { method: 'POST', body })
  },
  createInterview: () =>
    request<Interview>(endpoints.createInterview, { method: 'POST', body: JSON.stringify({ type: 'behavioral' }) }),
  uploadAnswer: (interviewId: string, questionId: string, wav: Blob) =>
    request<void>(endpoints.answer(interviewId, questionId), {
      method: 'POST',
      body: wav,
      headers: { 'Content-Type': 'audio/wav' },
    }),
  result: (resultId: string) => request<Result>(endpoints.result(resultId)),
  history: () => request<HistoryItem[]>(endpoints.history),
}

export type Api = typeof realApi

export const api: Api = USE_MOCK ? mockApi : realApi
