// Everything the app needs to know about the Python server lives here.
// Set VITE_API_URL in a .env.local file to the server's address, without a
// path, e.g. VITE_API_URL=http://192.168.1.42:8000 (use your computer's LAN IP,
// not localhost, when testing from the phone).
// Without it the app runs against the in-browser mock server (src/api/mock.ts).

export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
export const USE_MOCK = API_URL === ''

// DEBUG: shows which server this build talks to.
console.log(USE_MOCK ? '[api] VITE_API_URL is empty: using the in-browser mock server' : `[api] using server ${API_URL}`)

const v1 = '/api/v1'

export const endpoints = {
  health: '/health', //                                               GET -> Health
  profiles: `${v1}/profiles`, //                                      POST { full_name, experience_level } -> Profile
  profile: (id: string) => `${v1}/profiles/${id}`, //                 GET, PATCH -> Profile
  profileResume: (id: string) => `${v1}/profiles/${id}/resume`, //    GET -> ResumeInfo (404 resume_not_found), DELETE
  resumes: `${v1}/resumes`, //                                        POST multipart file + profile_id -> ResumeUpload
  companies: `${v1}/companies`, //                                    GET -> Company[]
  sessions: `${v1}/sessions`, //                                      POST -> SessionCreated; GET ?profile_id= -> list
  session: (id: string) => `${v1}/sessions/${id}`, //                 GET -> SessionDetail, DELETE
  questionShown: (id: string, position: number) => `${v1}/sessions/${id}/questions/${position}`, // PATCH { asked_at_ms }
  endSession: (id: string) => `${v1}/sessions/${id}/end`, //          POST -> SessionEnded
  audio: (id: string) => `${v1}/sessions/${id}/audio`, //             POST multipart file + duration_ms
  reprocess: (id: string) => `${v1}/sessions/${id}/reprocess`, //     POST
  report: (id: string) => `${v1}/sessions/${id}/report`, //           GET -> Report
  transcript: (id: string) => `${v1}/sessions/${id}/transcript`, //   GET -> Transcript
  biometrics: (id: string) => `${v1}/sessions/${id}/biometrics`, //   GET -> BiometricSeries
  suggestions: (id: string) => `${v1}/sessions/${id}/suggestions`, // GET -> { items: Suggestion[] }
  glassesSocket: (id: string) => `/ws/sessions/${id}/glasses`, //     WebSocket, see GlassesMessage
  systemDesignAttempts: (id: string) => `${v1}/sessions/${id}/system-design/attempts`, // POST multipart file + duration_ms
  systemDesignDiagram: (id: string) => `${v1}/sessions/${id}/system-design/diagram`, //   GET -> SystemDesignDiagramResponse
  systemDesignAccept: (id: string) => `${v1}/sessions/${id}/system-design/diagram/accept`, // POST { attempt_number }
  systemDesignReject: (id: string) => `${v1}/sessions/${id}/system-design/diagram/reject`, // POST { attempt_number, reason }
}


export const ROLE_TITLE = 'SWE Intern'
export const QUESTION_COUNT = 6
export const BRIEFING_SECONDS = 5 * 60

// Seconds between "Got it" and the next question.
export const BREATHER_SECONDS = 3

// The whole interview is one WAV upload capped at 100 MB by the server. At
// 16 kHz 16-bit mono that is ~52 minutes, so wrap up before then.
export const INTERVIEW_LIMIT_SECONDS = 45 * 60

// Silence detection that ends an answer. Only starts counting after the user
// has spoken, and waits long enough not to cut off a thinking pause.
export const SILENCE_SECONDS_TO_END = 6
export const SILENCE_RMS_THRESHOLD = 500 // int16 RMS
export const MIC_SAMPLE_RATE = 16000 // glasses mic PCM rate, used for the WAV header
