// Shapes exchanged with the Python server. The server owns Supabase and Gemini;
// this app only ever talks to the server.

export type User = {
  id: string
  name: string
  email: string
  hasResume: boolean
  resumeFileName?: string
  resumeSummary?: string // e.g. "4 projects · 2 internships"
}

export type Session = {
  token: string
  user: User
}

export type Company = {
  name: string
  tagline: string // "Logistics software · Series C · 420 people"
  about: string
  values: string[]
  projects: { name: string; description: string }[]
  tip?: string // Mocky's tip linking the resume to the company
}

export type Interview = {
  id: string
  company: Company
  briefingSeconds: number
  timeLimitSeconds: number
}

export type QuestionKind = 'general' | 'followup' | 'final'

export type Question = {
  id: string
  kind: QuestionKind
  text: string
}

// Events the server pushes over the live WebSocket.
export type LiveEvent =
  | { type: 'question'; question: Question }
  | { type: 'heart_rate'; bpm: number }
  | { type: 'final_round' }
  | { type: 'analyzing' }
  | { type: 'completed'; resultId: string }
  | { type: 'error'; message: string }

// Messages the app sends over the live WebSocket.
export type LiveCommand =
  | { type: 'ready' }
  | { type: 'answer_uploaded'; questionId: string; elapsedSeconds: number }
  | { type: 'finish'; reason: 'time_limit' | 'user' }

export type SignalKey = 'pauses' | 'fillers' | 'restarts' | 'voice' | 'pace' | 'off_topic'

export type Signal = {
  key: SignalKey
  label: string
  detail: string
  severity: 0 | 1 | 2 | 3 | 4
  clipIds: string[]
}

export type TranscriptPart = {
  text: string
  tag?: 'filler' | 'pause' | 'drift' | 'restart' | 'voice' | 'pace'
}

export type Clip = {
  id: string
  signal: SignalKey
  questionText: string
  audioUrl: string
  durationSeconds: number
  // Highlighted ranges inside the clip, in seconds.
  marks: { start: number; end: number; signal: SignalKey; label: string }[]
  transcript: TranscriptPart[]
  suggestion: string
}

export type Result = {
  id: string
  interviewId: string
  companyName: string
  createdAt: string
  durationSeconds: number
  score: number
  scoreDelta?: number
  headline: string
  signals: Signal[]
  strengths: string
  weaknesses: string
  clips: Clip[]
}

export type HistoryItem = {
  resultId: string
  companyName: string
  createdAt: string
  score: number
  topSignal: string
}
