import type { CSSProperties } from 'react'
import logoUrl from '../assets/logo.png'
import mockyUrl from '../assets/mocky.png'

export function Logo({ width = 128 }: { width?: number }) {
  // The logo image has generous padding baked in; crop it with a fixed aspect box.
  return (
    <div style={{ width, height: width * 0.36, overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
      <img src={logoUrl} alt="MockU" style={{ width: '100%', display: 'block' }} />
    </div>
  )
}

export function Mocky({
  size,
  className = '',
  style,
}: {
  size: number
  className?: string
  style?: CSSProperties
}) {
  return <img src={mockyUrl} alt="" className={`mocky ${className}`} style={{ width: size, height: size, ...style }} />
}

export const icons = {
  back: (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2L2 8l6 6" />
    </svg>
  ),
  chevron: (
    <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="#9AA3B2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 1.5L6.5 7l-5 5.5" />
    </svg>
  ),
  upload: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4C82F7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="M6 10l6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  ),
  check: (color = '#fff', size = 22) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  bigPlay: (
    <svg width="46" height="52" viewBox="0 0 46 52" style={{ flexShrink: 0 }}>
      <path d="M4 3 L43 26 L4 49 Z" fill="#fff" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  ),
  play: (color = '#4C82F7') => (
    <svg width="12" height="14" viewBox="0 0 12 14">
      <path d="M1 1l10 6-10 6z" fill={color} />
    </svg>
  ),
  pause: (
    <svg width="16" height="18" viewBox="0 0 16 18">
      <rect x="2" y="1" width="4" height="16" rx="1.5" fill="#fff" />
      <rect x="10" y="1" width="4" height="16" rx="1.5" fill="#fff" />
    </svg>
  ),
  history: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4C82F7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4l3 2" />
    </svg>
  ),
  glasses: (color = '#4C82F7') => (
    <svg width="44" height="20" viewBox="0 0 44 20" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
      <circle cx="10" cy="11" r="7.5" />
      <circle cx="34" cy="11" r="7.5" />
      <path d="M17.5 10c2.5-2 6.5-2 9 0" />
      <path d="M2.5 9L1 5M41.5 9L43 5" />
    </svg>
  ),
  heart: (
    <svg width="88" height="80" viewBox="0 0 24 22" style={{ position: 'absolute', left: 8, bottom: 4, transform: 'rotate(-8deg)' }}>
      <path d="M12 21s-8.5-5.3-10.6-10.4C-0.1 6.9 2.4 2 6.7 2c2.4 0 4.1 1.3 5.3 3 1.2-1.7 2.9-3 5.3-3 4.3 0 6.8 4.9 5.3 8.6C20.5 15.7 12 21 12 21z" fill="#E89A9A" />
    </svg>
  ),
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn" onClick={onClick} aria-label="Back">
      {icons.back}
    </button>
  )
}

const severityColor = ['#2FA866', '#2FA866', '#F5A524', '#F5A524', '#E5484D']

export function Meter({ severity }: { severity: number }) {
  return (
    <div className="meter" aria-label={`Severity ${severity} of 4`}>
      {[1, 2, 3, 4].map((step) => (
        <span key={step} style={step <= severity ? { background: severityColor[severity] } : undefined} />
      ))}
    </div>
  )
}

// Vertical bars for a list of 0..1 levels.
export function Bars({ levels, color, height }: { levels: number[]; color: string; height: number }) {
  const width = levels.length * 3
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {levels.map((level, i) => {
        const half = Math.max(1, (level * height) / 2)
        return <line key={i} x1={i * 3 + 1.5} x2={i * 3 + 1.5} y1={height / 2 - half} y2={height / 2 + half} stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      })}
    </svg>
  )
}

// Deterministic pseudo-waveform so a clip always draws the same shape.
export function seededLevels(seed: string, count: number) {
  let hash = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return Array.from({ length: count }, (_, i) => {
    hash = (hash * 1103515245 + 12345) >>> 0
    const noise = (hash % 1000) / 1000
    const envelope = 0.35 + 0.65 * Math.abs(Math.sin(i / 9))
    return Math.min(1, 0.08 + noise * envelope * 0.9)
  })
}

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
