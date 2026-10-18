// Shapes exchanged with the Python server (Backend/, see Backend/README.md).
// Field names match the server's JSON exactly. All *_ms values are elapsed
// milliseconds since the session's started_at.

export type ExperienceLevel = 'intern' | 'new_grad'

export type Profile = {
  id: string
  full_name: string
  experience_level: ExperienceLevel
  created_at: string
  updated_at?: string | null
}

// GET /profiles/{id}/resume
export type ResumeInfo = {
  id: string
  original_filename: string
  char_count: number
  created_at: string
  updated_at?: string | null
}

// POST /resumes
export type ResumeUpload = ResumeInfo & { text_preview: string }

export type Company = {
  id: string
  name: string
  industry?: string | null
  culture_summary?: string | null
  values: { name: string; description: string }[]
  website_url?: string | null
}

export type SessionStatus = 'recording' | 'processing' | 'done' | 'failed'

export type SessionQuestion = {
  position: number
  question_id: string
  text: string
  category: string
  asked_at_ms: number | null
}

// POST /sessions
export type SessionCreated = {
  id: string
  status: 'recording'
  started_at: string
  company_id: string
  resume_id: string
  role_title: string
  questions: SessionQuestion[]
}

// GET /sessions/{id}
export type SessionDetail = {
  id: string
  status: SessionStatus
  company_id: string
  resume_id: string
  role_title: string
  started_at: string
  ended_at?: string | null
  has_audio: boolean
  report_ready: boolean
  questions: SessionQuestion[]
}

// POST /sessions/{id}/end
export type SessionEnded = {
  id: string
  status: string
  ended_at: string
  duration_ms: number
}

// GET /sessions?profile_id=
export type SessionListItem = {
  id: string
  company: { id: string; name: string }
  role_title?: string | null
  status: SessionStatus
  started_at: string
  ended_at?: string | null
  duration_ms?: number | null
  overall_score?: number | null
}

export type Severity = 'low' | 'medium' | 'high'

export type Finding = {
  id: string
  category: string // e.g. 'technical', 'biometric'
  start_ms: number
  end_ms: number
  severity: Severity
  title: string
  details: { note?: string; [key: string]: unknown }
}

// The server stores summary as free-form JSON; these are the keys the pipeline writes.
export type ReportSummary = {
  overview?: string
  communication_score?: number
  technical_depth_score?: number
  composure_score?: number
  key_strengths?: string[]
  areas_for_growth?: string[]
  [key: string]: unknown
}

// GET /sessions/{id}/report. report is null until status is 'done'.
export type Report = {
  session_id: string
  status: SessionStatus
  report: {
    overall_score: number | null
    schema_version: string
    summary: ReportSummary
    findings: Finding[]
  } | null
}

export type TranscriptSegment = { start_ms: number; end_ms: number; text: string }

export type Transcript = {
  session_id: string
  status: SessionStatus
  segments: TranscriptSegment[]
}

export type BiometricSeries = {
  session_id: string
  stats: {
    count: number
    min_bpm: number | null
    max_bpm: number | null
    avg_bpm: number | null
    baseline_bpm: number | null
  }
  points: { t_ms: number; bpm_avg: number; bpm_max: number }[]
}

// Tips the server pushed to the glasses during the interview.
export type Suggestion = {
  id: string
  t_ms: number
  text: string
  severity: Severity
  trigger_reason: string
  bpm_at_trigger?: number | null
  baseline_bpm?: number | null
  delivered_at?: string | null
}

// Messages on WS /ws/sessions/{id}/glasses, server to app.
export type GlassesMessage =
  | { type: 'suggestion'; id: string; t_ms: number; text: string; severity: Severity; ttl_ms: number }
  | { type: 'sensor_status'; state: 'online' | 'offline'; last_bpm: number | null }
  | { type: 'session_ended' }
  | { type: 'ping' }

// App to server.
export type GlassesReply = { type: 'ack'; suggestion_id: string } | { type: 'pong' }

export type Health = { status: 'ok' | 'degraded'; database: 'ok' | 'unreachable'; time: string }
