// Everything the app needs to know about the Python server lives here.
// Set VITE_API_URL in a .env.local file, e.g. VITE_API_URL=https://api.example.com
// Without it the app runs against the in-browser mock server (src/api/mock.ts).

export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
export const USE_MOCK = API_URL === ''

// Placeholder paths; rename them here once the server routes are final.
export const endpoints = {
  signUp: '/auth/signup', //                 POST { name, email, password } -> Session
  signIn: '/auth/login', //                  POST { email, password } -> Session
  me: '/me', //                              GET -> User
  resume: '/resume', //                      POST multipart "file" (PDF) -> User
  createInterview: '/interviews', //         POST { type: 'behavioral' } -> Interview
  answer: (interviewId: string, questionId: string) =>
    `/interviews/${interviewId}/answers/${questionId}`, // POST audio/wav body
  result: (resultId: string) => `/results/${resultId}`, // GET -> Result
  history: '/results', //                    GET -> HistoryItem[]
  // WebSocket, token passed as query param. Server pushes LiveEvent, app sends LiveCommand.
  live: (interviewId: string) => `/interviews/${interviewId}/live`,
}

// Overall interview length. Never shown as a countdown; when less than
// WRAP_UP_SECONDS remain after an answer, the app asks the server to finish.
export const INTERVIEW_LIMIT_SECONDS = 30 * 60
export const WRAP_UP_SECONDS = 3 * 60

// Silence detection that ends an answer. Only starts counting after the user
// has spoken, and waits long enough not to cut off a thinking pause.
export const SILENCE_SECONDS_TO_END = 6
export const SILENCE_RMS_THRESHOLD = 500 // int16 RMS
export const MIC_SAMPLE_RATE = 16000 // glasses mic PCM rate, used for the WAV header
