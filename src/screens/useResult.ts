import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Result } from '../api/types'

const cache = new Map<string, Result>()

export function useResult(resultId: string) {
  const [result, setResult] = useState<Result | null>(cache.get(resultId) ?? null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (cache.has(resultId)) return
    let cancelled = false
    api
      .result(resultId)
      .then((value) => {
        cache.set(resultId, value)
        if (!cancelled) setResult(value)
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Couldn't load results."))
    return () => {
      cancelled = true
    }
  }, [resultId])

  return { result, error }
}
