// In-browser stand-in for the Python server, used when VITE_API_URL is not set.
// Mirrors the real contract (Backend/README.md) so screens can be built and
// demoed without a backend. State lives in memory and resets on reload.
import type {
  BiometricSeries,
  Company,
  ExperienceLevel,
  Finding,
  GlassesMessage,
  Health,
  Profile,
  Report,
  ResumeInfo,
  ResumeUpload,
  SessionCreated,
  SessionDetail,
  SessionEnded,
  SessionListItem,
  SessionQuestion,
  Suggestion,
  Transcript,
} from './types'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const now = () => new Date().toISOString()
// crypto.randomUUID only exists on secure pages; the phone loads the dev
// server over plain http on the LAN.
const uuid = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

let profile: Profile | null = null
let resume: ResumeInfo | null = null

const companies: Company[] = [
  {
    id: 'c-stripe',
    name: 'Stripe',
    industry: 'Fintech',
    culture_summary: 'High ownership, written communication, and rigorous technical execution.',
    values: [
      { name: 'Users first', description: 'Start from the problem the user actually has.' },
      { name: 'Move with urgency', description: 'Iterate quickly and learn from feedback.' },
      { name: 'Write it down', description: 'Clear written thinking over meetings.' },
    ],
    website_url: 'https://stripe.com',
  },
  {
    id: 'c-tidewater',
    name: 'Tidewater',
    industry: 'Logistics software',
    culture_summary: 'Small teams that each own one product end to end, with drivers at the center of every decision.',
    values: [
      { name: 'Own the outcome', description: 'You ship it, you watch it in production.' },
      { name: 'Say it plainly', description: 'Direct feedback, kindly delivered.' },
      { name: 'Drivers first', description: 'Every feature is judged by the people on the road.' },
    ],
    website_url: null,
  },
]

const questionBank = [
  'Walk me through your resume and what brought you here.',
  'Tell me about a time you disagreed with a teammate.',
  'Describe a project where you had to ship with incomplete information.',
  'Tell me about a challenging bug and how you tracked it down.',
  'What is your biggest professional failure?',
  'Why do you want to work on this team?',
  'Tell me about a time you had to learn something fast.',
]

type MockSession = SessionDetail & { profile_id: string; durationMs: number | null; suggestions: Suggestion[] }
const sessions = new Map<string, MockSession>()
let liveSessionId: string | null = null

function notFound(what: string): never {
  throw Object.assign(new Error(`${what} not found.`), { code: 'NOT_FOUND', status: 404 })
}

function getMockSession(id: string) {
  return sessions.get(id) ?? notFound('Session')
}

export const mockApi = {
  async health(): Promise<Health> {
    return { status: 'ok', database: 'ok', time: now() }
  },

  async createProfile(fullName: string, level: ExperienceLevel): Promise<Profile> {
    await wait(300)
    profile = { id: uuid(), full_name: fullName, experience_level: level, created_at: now(), updated_at: now() }
    resume = null
    return profile
  },
  async getProfile(id: string): Promise<Profile> {
    if (!profile || profile.id !== id) notFound('Profile')
    return profile
  },
  async updateProfile(id: string, changes: { full_name?: string; experience_level?: ExperienceLevel }): Promise<Profile> {
    await wait(300)
    if (!profile || profile.id !== id) notFound('Profile')
    profile = { ...profile, ...changes, updated_at: now() }
    return profile
  },

  async getResume(_profileId: string): Promise<ResumeInfo | null> {
    return resume
  },
  async uploadResume(_profileId: string, file: File): Promise<ResumeUpload> {
    await wait(1200)
    resume = { id: uuid(), original_filename: file.name, char_count: 2840, created_at: now(), updated_at: now() }
    return { ...resume, text_preview: 'Software engineering student with internship experience…' }
  },
  async deleteResume(_profileId: string): Promise<void> {
    await wait(300)
    resume = null
  },

  async listCompanies(): Promise<Company[]> {
    await wait(300)
    return companies
  },

  async createSession(profileId: string, companyId: string, resumeId: string): Promise<SessionCreated> {
    await wait(400)
    const picked = [...questionBank].sort(() => Math.random() - 0.5).slice(0, 4)
    const questions: SessionQuestion[] = picked.map((text, i) => ({
      position: i + 1,
      question_id: uuid(),
      text,
      category: 'Behavioral',
      asked_at_ms: null,
    }))
    const session: MockSession = {
      id: uuid(),
      status: 'recording',
      company_id: companyId,
      resume_id: resumeId,
      role_title: 'SWE Intern',
      started_at: now(),
      ended_at: null,
      has_audio: false,
      report_ready: false,
      questions,
      profile_id: profileId,
      durationMs: null,
      suggestions: [],
    }
    sessions.set(session.id, session)
    liveSessionId = session.id
    return { ...session, status: 'recording', questions: questions.map((q) => ({ ...q })) }
  },
  async getSession(id: string): Promise<SessionDetail> {
    const { profile_id: _p, durationMs: _d, suggestions: _s, ...detail } = getMockSession(id)
    return { ...detail, questions: detail.questions.map((q) => ({ ...q })) }
  },
  async listSessions(profileId: string): Promise<{ items: SessionListItem[]; total: number }> {
    await wait(300)
    const items = [...sessions.values()]
      .filter((s) => s.profile_id === profileId)
      .reverse()
      .map((s) => ({
        id: s.id,
        company: { id: s.company_id, name: companies.find((c) => c.id === s.company_id)?.name ?? 'Mock Company' },
        role_title: s.role_title,
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at,
        duration_ms: s.durationMs,
        overall_score: s.status === 'done' ? scoreFor(s) : null,
      }))
    return { items, total: items.length }
  },
  async markQuestionShown(id: string, position: number, askedAtMs: number) {
    const question = getMockSession(id).questions.find((q) => q.position === position) ?? notFound('Question')
    question.asked_at_ms = askedAtMs
    return { position, asked_at_ms: askedAtMs }
  },
  async endSession(id: string): Promise<SessionEnded> {
    await wait(300)
    const session = getMockSession(id)
    session.ended_at ??= now()
    session.durationMs = Date.parse(session.ended_at) - Date.parse(session.started_at)
    if (liveSessionId === id) liveSessionId = null
    return { id, status: session.status, ended_at: session.ended_at, duration_ms: session.durationMs }
  },
  async uploadAudio(id: string, _wav: Blob, _durationMs: number) {
    await wait(800)
    const session = getMockSession(id)
    session.has_audio = true
    session.status = 'processing'
    setTimeout(() => {
      session.status = 'done'
      session.report_ready = true
    }, 3000)
    return { session_id: id, status: 'processing' as const }
  },
  async reprocess(id: string) {
    const session = getMockSession(id)
    session.status = 'processing'
    setTimeout(() => (session.status = 'done'), 3000)
    return { session_id: id, status: 'processing' as const }
  },
  async deleteSession(id: string): Promise<void> {
    await wait(300)
    sessions.delete(id)
  },

  async getReport(id: string): Promise<Report> {
    await wait(300)
    const session = getMockSession(id)
    if (session.status !== 'done') return { session_id: id, status: session.status, report: null }
    const asked = session.questions.filter((q) => q.asked_at_ms != null)
    const findings: Finding[] = asked.slice(0, 3).map((q, i) => ({
      id: `f-${q.position}`,
      category: i === 1 ? 'biometric' : 'communication',
      start_ms: q.asked_at_ms! + 6000,
      end_ms: q.asked_at_ms! + 14000,
      severity: (['medium', 'high', 'low'] as const)[i]!,
      title: ['Long pause before answering', 'Heart rate spiked', 'Clear, structured story'][i]!,
      details: {
        note: [
          'You paused for about 5 seconds before starting. Have a one-line opener ready.',
          'Your pulse rose to 112 BPM while describing the conflict, then settled.',
          'You opened with the decision, then the why. Keep doing this.',
        ][i],
      },
    }))
    return {
      session_id: id,
      status: 'done',
      report: {
        overall_score: scoreFor(session),
        schema_version: '1.0.0',
        summary: {
          overview: 'Your stories land. You hesitate before the easy questions.',
          communication_score: 74,
          technical_depth_score: 68,
          composure_score: 81,
          key_strengths: ['Specific numbers in your project stories', 'Stayed calm on the failure question'],
          areas_for_growth: ['Open with the decision, then the context', 'Say "I" instead of "we" for your own work'],
        },
        findings,
      },
    }
  },
  async getTranscript(id: string): Promise<Transcript> {
    const session = getMockSession(id)
    const segments = session.questions
      .filter((q) => q.asked_at_ms != null)
      .flatMap((q) => [
        { start_ms: q.asked_at_ms! + 6000, end_ms: q.asked_at_ms! + 10000, text: 'So, um… at my internship we had a sprint where' },
        { start_ms: q.asked_at_ms! + 10000, end_ms: q.asked_at_ms! + 16000, text: 'I pushed back on the launch date because offline mode was not safe yet.' },
      ])
    return { session_id: id, status: session.status, segments }
  },
  async getBiometrics(id: string): Promise<BiometricSeries> {
    const session = getMockSession(id)
    const duration = session.durationMs ?? 60000
    let bpm = 74
    const points = Array.from({ length: Math.max(2, Math.floor(duration / 5000)) }, (_, i) => {
      bpm = Math.max(64, Math.min(118, bpm + Math.round((Math.random() - 0.45) * 6)))
      return { t_ms: i * 5000, bpm_avg: bpm, bpm_max: bpm + 2 }
    })
    const values = points.map((p) => p.bpm_avg)
    return {
      session_id: id,
      stats: {
        count: points.length,
        min_bpm: Math.min(...values),
        max_bpm: Math.max(...values),
        avg_bpm: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
        baseline_bpm: 74,
      },
      points,
    }
  },
  async getSuggestions(id: string) {
    return { session_id: id, items: getMockSession(id).suggestions }
  },
}

function scoreFor(session: MockSession) {
  return 60 + (session.id.charCodeAt(0) % 30)
}

// Fake live channel: reports the watch online and sends one breathing tip.
export function mockGlassesSocket(onMessage: (message: GlassesMessage) => void) {
  let closed = false
  const emit = (message: GlassesMessage) => !closed && onMessage(message)
  const sessionId = liveSessionId
  const timers = [
    setTimeout(() => emit({ type: 'sensor_status', state: 'online', last_bpm: 76 }), 800),
    setTimeout(() => {
      const startedAt = sessionId ? Date.parse(getMockSession(sessionId).started_at) : Date.now()
      const tip: Suggestion = {
        id: uuid(),
        t_ms: Date.now() - startedAt,
        text: 'Take a slow breath',
        severity: 'medium',
        trigger_reason: 'bpm_spike',
        bpm_at_trigger: 104,
        baseline_bpm: 76,
      }
      if (sessionId) sessions.get(sessionId)?.suggestions.push(tip)
      emit({ type: 'suggestion', id: tip.id, t_ms: tip.t_ms, text: tip.text, severity: tip.severity, ttl_ms: 6000 })
    }, 25000),
  ]
  return {
    close() {
      closed = true
      timers.forEach(clearTimeout)
    },
  }
}
