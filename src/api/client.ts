import { API_URL, QUESTION_COUNT, ROLE_TITLE, USE_MOCK, endpoints } from './config'
import { mockApi } from './mock'
import type {
  BiometricSeries,
  Company,
  ExperienceLevel,
  Health,
  Profile,
  Report,
  ResumeInfo,
  ResumeUpload,
  SessionCreated,
  SessionDetail,
  SessionEnded,
  SessionListItem,
  Suggestion,
  Transcript,
} from './types'

// The server has no login; the candidate is identified by a profile id kept on the phone.
const PROFILE_KEY = 'mocku.profileId'

export function getProfileId() {
  try {
    return localStorage.getItem(PROFILE_KEY)
  } catch {
    return null
  }
}

export function setProfileId(value: string | null) {
  try {
    if (value) localStorage.setItem(PROFILE_KEY, value)
    else localStorage.removeItem(PROFILE_KEY)
  } catch {
    // storage unavailable; the profile is forgotten on reload
  }
}

// Errors from the server arrive as { "error": { "code", "message" } }.
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

// Uploads (resume, interview audio) can be large; everything else should be quick.
const TIMEOUT_MS = 15000
const UPLOAD_TIMEOUT_MS = 180000

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json')
  const method = init.method ?? 'GET'
  const url = API_URL + path
  const started = performance.now()
  const ms = () => `${Math.round(performance.now() - started)}ms`
  // DEBUG: remove once the backend connection is stable.
  console.log(`[api] → ${method} ${url}`, typeof init.body === 'string' ? init.body : '')

  // Without a timeout, an unreachable address can hang for minutes on the phone.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.body instanceof FormData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { ...init, headers, signal: controller.signal })
  } catch (err) {
    const timedOut = controller.signal.aborted
    console.error(`[api] ✗ ${method} ${url} ${timedOut ? 'timed out' : 'network error'} after ${ms()}`, err)
    throw new ApiError(
      timedOut ? `The MockU server at ${API_URL} didn't answer in time.` : `Can't reach the MockU server at ${API_URL}.`,
      'NETWORK_ERROR',
      0,
    )
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const error = body?.error
    console.error(`[api] ✗ ${method} ${url} ${res.status} after ${ms()}`, body)
    throw new ApiError(error?.message ?? `Request failed (${res.status})`, error?.code ?? 'HTTP_ERROR', res.status)
  }
  const data = res.status === 204 ? (undefined as T) : await res.json()
  console.log(`[api] ✓ ${method} ${url} ${res.status} after ${ms()}`, data)
  return data
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

const realApi = {
  health: () => request<Health>(endpoints.health),

  createProfile: (fullName: string, level: ExperienceLevel) =>
    request<Profile>(endpoints.profiles, json('POST', { full_name: fullName, experience_level: level })),
  getProfile: (id: string) => request<Profile>(endpoints.profile(id)),
  updateProfile: (id: string, changes: { full_name?: string; experience_level?: ExperienceLevel }) =>
    request<Profile>(endpoints.profile(id), json('PATCH', changes)),

  // null when the candidate hasn't uploaded one yet.
  getResume: async (profileId: string) => {
    try {
      return await request<ResumeInfo>(endpoints.profileResume(profileId))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'resume_not_found') return null
      throw err
    }
  },
  uploadResume: (profileId: string, file: File) => {
    const body = new FormData()
    body.append('file', file)
    body.append('profile_id', profileId)
    return request<ResumeUpload>(endpoints.resumes, { method: 'POST', body })
  },
  deleteResume: (profileId: string) => request<void>(endpoints.profileResume(profileId), { method: 'DELETE' }),

  listCompanies: () => request<Company[]>(endpoints.companies),

  // Starts the interview clock (t = 0) on the server.
  createSession: (profileId: string, companyId: string, resumeId: string) =>
    request<SessionCreated>(
      endpoints.sessions,
      json('POST', {
        profile_id: profileId,
        company_id: companyId,
        resume_id: resumeId,
        role_title: ROLE_TITLE,
        question_count: QUESTION_COUNT,
      }),
    ),
  getSession: (id: string) => request<SessionDetail>(endpoints.session(id)),
  listSessions: (profileId: string) =>
    request<{ items: SessionListItem[]; total: number }>(`${endpoints.sessions}?profile_id=${encodeURIComponent(profileId)}&limit=50`),
  markQuestionShown: (id: string, position: number, askedAtMs: number) =>
    request<{ position: number; asked_at_ms: number }>(endpoints.questionShown(id, position), json('PATCH', { asked_at_ms: askedAtMs })),
  endSession: (id: string) => request<SessionEnded>(endpoints.endSession(id), { method: 'POST' }),
  uploadAudio: (id: string, wav: Blob, durationMs: number) => {
    const body = new FormData()
    body.append('file', wav, 'interview.wav')
    body.append('duration_ms', String(Math.round(durationMs)))
    return request<{ session_id: string; status: 'processing' }>(endpoints.audio(id), { method: 'POST', body })
  },
  reprocess: (id: string) => request<{ session_id: string; status: 'processing' }>(endpoints.reprocess(id), { method: 'POST' }),
  deleteSession: (id: string) => request<void>(endpoints.session(id), { method: 'DELETE' }),

  getReport: (id: string) => request<Report>(endpoints.report(id)),
  getTranscript: (id: string) => request<Transcript>(endpoints.transcript(id)),
  getBiometrics: (id: string) => request<BiometricSeries>(`${endpoints.biometrics(id)}?max_points=300`),
  getSuggestions: (id: string) => request<{ session_id: string; items: Suggestion[] }>(endpoints.suggestions(id)),
}

export type Api = typeof realApi

export const api: Api = USE_MOCK ? mockApi : realApi

// Company names for results/history; the session only carries company_id.
let companiesPromise: Promise<Company[]> | null = null
export function getCompanies() {
  companiesPromise ??= api.listCompanies().catch((err) => {
    companiesPromise = null
    throw err
  })
  return companiesPromise
}

export function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback
}
