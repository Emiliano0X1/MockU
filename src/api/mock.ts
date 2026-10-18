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
  SessionMode,
  SessionQuestion,
  Suggestion,
  SystemDesignDiagramResponse,
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

  async createSession(profileId: string, companyId: string, resumeId: string, mode: SessionMode = 'behavioral'): Promise<SessionCreated> {
    await wait(400)
    const design = mode === 'system_design'
    const picked = design
      ? [designPrompts[Math.floor(Math.random() * designPrompts.length)]!]
      : [...questionBank].sort(() => Math.random() - 0.5).slice(0, 4)
    const questions: SessionQuestion[] = picked.map((text, i) => ({
      position: i + 1,
      question_id: uuid(),
      text,
      category: design ? 'System Design' : 'Behavioral',
      asked_at_ms: null,
    }))
    const session: MockSession = {
      id: uuid(),
      mode,
      status: 'recording',
      company_id: companyId,
      resume_id: resumeId,
      role_title: design ? 'Senior Systems Engineer' : 'SWE Intern',
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
        mode: s.mode,
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
  // System design lifecycle, as on the server: recording -> interpreting ->
  // awaiting_review -> grading -> done (or cancelled).
  async uploadSystemDesignAttempt(id: string, _wav: Blob, _durationMs: number, attemptNumber = 1) {
    await wait(800)
    const session = getMockSession(id)
    session.status = 'interpreting'
    session.ended_at ??= now()
    session.durationMs = Date.parse(session.ended_at) - Date.parse(session.started_at)
    if (liveSessionId === id) liveSessionId = null
    setTimeout(() => (session.status = 'awaiting_review'), 2500)
    return { session_id: id, attempt_number: attemptNumber, status: 'interpreting' as const }
  },
  async getSystemDesignDiagram(id: string): Promise<SystemDesignDiagramResponse> {
    await wait(300)
    if (getMockSession(id).status === 'interpreting') {
      return { session_id: id, attempt_number: 1, status: 'pending', graph: null, glasses_summary: null, can_retry: false }
    }
    return {
      session_id: id,
      attempt_number: 1,
      status: 'ready' as const,
      graph: {
        schema_version: '1.0.0',
        prompt: 'Design a URL Shortener',
        nodes: [
          { id: 'node_client', type: 'client', label: 'Client App', description: 'Web or mobile client' },
          { id: 'node_cdn', type: 'cdn', label: 'Edge CDN', description: 'Caches hot URLs' },
          { id: 'node_lb', type: 'load_balancer', label: 'Load Balancer', description: 'Balances HTTP traffic' },
          { id: 'node_api', type: 'api_service', label: 'URL Service', description: 'Hash generation & redirection' },
          { id: 'node_cache', type: 'cache', label: 'Redis Cache', description: 'Hot mappings cache' },
          { id: 'node_db', type: 'database', label: 'PostgreSQL', description: 'Primary store' },
          { id: 'node_queue', type: 'queue', label: 'Kafka Queue', description: 'Analytics queue' },
          { id: 'node_worker', type: 'worker', label: 'Analytics Worker', description: 'Processes click metrics' },
        ],
        edges: [
          { id: 'e1', source: 'node_client', target: 'node_cdn', label: 'GET /:short', protocol: 'HTTPS' },
          { id: 'e2', source: 'node_cdn', target: 'node_lb', label: 'Cache miss', protocol: 'HTTPS' },
          { id: 'e3', source: 'node_lb', target: 'node_api', label: 'Route', protocol: 'HTTPS' },
          { id: 'e4', source: 'node_api', target: 'node_cache', label: 'Lookup', protocol: 'TCP' },
          { id: 'e5', source: 'node_api', target: 'node_db', label: 'Query/Write', protocol: 'SQL' },
          { id: 'e6', source: 'node_api', target: 'node_queue', label: 'Emit event', protocol: 'Async' },
          { id: 'e7', source: 'node_queue', target: 'node_worker', label: 'Process', protocol: 'Batch' },
        ],
      },
      glasses_summary: {
        component_count: 8,
        components: ['Client App', 'Edge CDN', 'Load Balancer', 'URL Service', 'Redis Cache', 'PostgreSQL', 'Kafka Queue', 'Analytics Worker'],
      },
      can_retry: false,
    }
  },
  async acceptSystemDesignDiagram(id: string, _attemptNumber = 1) {
    await wait(300)
    const session = getMockSession(id)
    session.status = 'grading'
    setTimeout(() => {
      session.status = 'done'
      session.report_ready = true
    }, 2500)
    return { session_id: id, status: 'grading' as const }
  },
  async rejectSystemDesignDiagram(id: string, _attemptNumber = 1, _reason?: string) {
    await wait(300)
    const session = getMockSession(id)
    session.status = 'cancelled'
    return { session_id: id, status: 'cancelled' as const }
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
    if (session.mode === 'system_design') return designReport(session)
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

const designPrompts = [
  'Design a URL shortener like Bitly',
  'Design a news feed like Twitter',
  'Design a rate limiter for a public API',
]

// Same shape as the backend's system design grading (summary_json + findings
// with observation/recommendation).
function designReport(session: MockSession): Report {
  const at = session.questions[0]?.asked_at_ms ?? 0
  return {
    session_id: session.id,
    status: 'done',
    report: {
      overall_score: scoreFor(session),
      schema_version: '2.0.0',
      summary: {
        overview: 'Solid core design. Spend more time on failure modes and scaling the database.',
        architecture_score: 82,
        scalability_score: 71,
        tradeoffs_score: 68,
        communication_score: 85,
        key_strengths: ['Put a cache in front of the database for hot reads', 'Used a queue to keep analytics off the request path'],
        areas_for_growth: ['Explain how the database is replicated and fails over', 'Justify the cache eviction policy'],
      },
      findings: [
        {
          id: 'sd-1',
          category: 'missing_component',
          start_ms: at + 20000,
          end_ms: at + 32000,
          severity: 'medium',
          title: 'No database replication',
          details: {
            observation: 'A single primary database with no replica or failover.',
            recommendation: 'Add a read replica and automatic failover, and say how you would detect the outage.',
          },
        },
        {
          id: 'sd-2',
          category: 'unjustified_choice',
          start_ms: at + 45000,
          end_ms: at + 55000,
          severity: 'low',
          title: 'Cache eviction not explained',
          details: {
            observation: 'Redis was added, but not how it stays within memory.',
            recommendation: 'Mention LRU eviction and a TTL for short links.',
          },
        },
      ],
    },
  }
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
