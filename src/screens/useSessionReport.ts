import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage, getCompanies } from '../api/client'
import type { BiometricSeries, Report, SessionDetail, Suggestion, SystemDesignGraph, TranscriptSegment } from '../api/types'

export type SessionReport = {
  detail: SessionDetail
  companyName: string
  report: NonNullable<Report['report']>
  segments: TranscriptSegment[]
  heart: BiometricSeries
  tips: Suggestion[]
  // System design only: the diagram the candidate submitted.
  graph: SystemDesignGraph | null
}

type State =
  | { kind: 'loading' }
  | { kind: 'processing' } // audio uploaded, analysis running
  | { kind: 'missing' } // interview ended without an uploaded recording
  | { kind: 'unsubmitted' } // system design: diagram drawn but never submitted
  | { kind: 'cancelled' } // system design: the candidate cancelled the attempt
  | { kind: 'failed' } // analysis failed on the server
  | { kind: 'error'; message: string }
  | { kind: 'done'; data: SessionReport }

const POLL_MS = 3000
const cache = new Map<string, SessionReport>()

// Loads everything the results screens need, polling while the server is
// still analyzing the interview.
export function useSessionReport(sessionId: string) {
  const cached = cache.get(sessionId)
  const [state, setState] = useState<State>(cached ? { kind: 'done', data: cached } : { kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (cache.has(sessionId)) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = async () => {
      try {
        const detail = await api.getSession(sessionId)
        if (cancelled) return
        // Still working on the server: behavioral analysis, or drawing/grading a design.
        if (detail.status === 'processing' || detail.status === 'interpreting' || detail.status === 'grading') {
          setState({ kind: 'processing' })
          timer = setTimeout(check, POLL_MS)
          return
        }
        if (detail.status === 'failed') return setState({ kind: 'failed' })
        if (detail.status === 'recording') return setState({ kind: 'missing' })
        if (detail.status === 'awaiting_review') return setState({ kind: 'unsubmitted' })
        if (detail.status === 'cancelled') return setState({ kind: 'cancelled' })

        const design = detail.mode === 'system_design'
        const [report, transcript, heart, tips, companies, diagram] = await Promise.all([
          api.getReport(sessionId),
          api.getTranscript(sessionId).catch(() => null),
          api.getBiometrics(sessionId).catch(() => null),
          api.getSuggestions(sessionId).catch(() => null),
          getCompanies().catch(() => []),
          design ? api.getSystemDesignDiagram(sessionId).catch(() => null) : Promise.resolve(null),
        ])
        if (cancelled) return
        if (!report.report) {
          timer = setTimeout(check, POLL_MS)
          return
        }
        const data: SessionReport = {
          detail,
          companyName: companies.find((c) => c.id === detail.company_id)?.name ?? 'Mock',
          report: report.report,
          segments: transcript?.segments ?? [],
          heart: heart ?? { session_id: sessionId, stats: { count: 0, min_bpm: null, max_bpm: null, avg_bpm: null, baseline_bpm: null }, points: [] },
          tips: tips?.items ?? [],
          graph: diagram?.graph ?? null,
        }
        cache.set(sessionId, data)
        setState({ kind: 'done', data })
      } catch (err) {
        if (!cancelled) setState({ kind: 'error', message: errorMessage(err, "Couldn't load your results.") })
      }
    }

    check()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sessionId, attempt])

  const retry = useCallback(() => {
    setState({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  // Re-runs the server's analysis, e.g. after it failed.
  const reprocess = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      await api.reprocess(sessionId)
      cache.delete(sessionId)
      setAttempt((n) => n + 1)
    } catch (err) {
      setState({ kind: 'error', message: errorMessage(err, "Couldn't restart the analysis.") })
    }
  }, [sessionId])

  return { state, retry, reprocess }
}

export function forgetSessionReport(sessionId: string) {
  cache.delete(sessionId)
}

// "1:23" from milliseconds.
export function formatMs(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
