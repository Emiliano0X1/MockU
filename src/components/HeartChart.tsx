import type { BiometricSeries } from '../api/types'

type Band = { start_ms: number; end_ms: number; color: string }

// Heart rate over the interview (or a window of it), with the resting
// baseline and highlighted time ranges such as findings.
export function HeartChart({
  heart,
  from,
  to,
  bands = [],
  height = 110,
}: {
  heart: BiometricSeries
  from?: number
  to?: number
  bands?: Band[]
  height?: number
}) {
  const width = 300
  const points = heart.points.filter((p) => (from == null || p.t_ms >= from) && (to == null || p.t_ms <= to))
  if (points.length < 2) {
    return (
      <div className="small" style={{ height: 48, display: 'flex', alignItems: 'center' }}>
        No heart-rate data for this part of the interview.
      </div>
    )
  }

  const start = from ?? points[0]!.t_ms
  const end = Math.max(to ?? points[points.length - 1]!.t_ms, start + 1)
  const baseline = heart.stats.baseline_bpm
  const values = points.map((p) => p.bpm_avg).concat(baseline ?? [])
  const min = Math.min(...values) - 4
  const max = Math.max(...values) + 4
  const x = (t: number) => ((t - start) / (end - start)) * (width - 12) + 6
  const y = (bpm: number) => height - 8 - ((bpm - min) / (max - min)) * (height - 16)
  const last = points[points.length - 1]!

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label={`Heart rate between ${Math.round(min + 4)} and ${Math.round(max - 4)} bpm`}>
      {bands.map((band) => (
        <rect
          key={`${band.start_ms}-${band.end_ms}`}
          x={x(Math.max(start, band.start_ms))}
          width={Math.max(2, x(Math.min(end, band.end_ms)) - x(Math.max(start, band.start_ms)))}
          y={0}
          height={height}
          rx={4}
          fill={band.color}
          opacity={0.18}
        />
      ))}
      {baseline != null && (
        <line x1="0" x2={width} y1={y(baseline)} y2={y(baseline)} stroke="#9AA3B2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      )}
      <polyline
        points={points.map((p) => `${x(p.t_ms)},${y(p.bpm_avg)}`).join(' ')}
        fill="none"
        stroke="#E5484D"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(last.t_ms)} cy={y(last.bpm_avg)} r="4" fill="#fff" stroke="#E5484D" strokeWidth="3" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
