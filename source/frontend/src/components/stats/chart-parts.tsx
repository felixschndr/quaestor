import { formatEuro } from '@/lib/format'

// Roughly the width one character of the label needs, used to decide whether the
// value fits inside its bar.
const APPROX_CHAR_WIDTH = 6.5

export interface BarValueLabelProps {
  // Injected by recharts' <LabelList content={...}> via cloneElement.
  x?: number
  y?: number
  width?: number
  height?: number
  value?: number
  /** Text color when the label sits inside the (colored) bar. Outside labels
   *  always use the foreground color since they're drawn on the card. */
  insideFill?: string
}

/**
 * Value label for a horizontal bar: rendered inside the bar when it's wide
 * enough, otherwise just to its right — so short bars don't overlap whatever is
 * to their left.
 */
export function BarValueLabel({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  value,
  insideFill = 'var(--color-foreground)',
}: BarValueLabelProps) {
  if (value == null) return null
  const text = formatEuro(value)
  const fitsInside = width >= text.length * APPROX_CHAR_WIDTH + 10
  return (
    <text
      x={fitsInside ? x + width - 6 : x + width + 6}
      y={y + height / 2}
      dy="0.32em"
      textAnchor={fitsInside ? 'end' : 'start'}
      fontSize={11}
      fontWeight={600}
      fill={fitsInside ? insideFill : 'var(--color-foreground)'}
    >
      {text}
    </text>
  )
}

export interface ToggleTickProps {
  // x/y/payload are injected by recharts via the <YAxis tick={...}> element.
  y?: number
  payload?: { value?: string | number }
  /** Resolves the axis key (payload.value) to a display label. */
  labelOf: (key: string) => string
  /** Keys currently toggled off (rendered greyed + struck through). */
  hidden: ReadonlySet<string>
  /** Toggle a key's visibility. */
  onToggle: (key: string) => void
  /** Truncate labels longer than this (with an ellipsis). */
  maxChars?: number
}

/**
 * Left-aligned, clickable category Y-axis tick. Recharts right-aligns category
 * labels against the axis line (leaving a gap on the left); anchoring at the
 * left edge uses that space. Clicking the label toggles the row's visibility —
 * the label stays put (greyed) so it can be switched back on.
 */
export function ToggleTick({
  y = 0,
  payload,
  labelOf,
  hidden,
  onToggle,
  maxChars = 40,
}: ToggleTickProps) {
  const key = String(payload?.value ?? '')
  const raw = labelOf(key)
  const label = raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}…` : raw
  const isHidden = hidden.has(key)
  return (
    <text
      x={6}
      y={y}
      dy="0.32em"
      textAnchor="start"
      fill={isHidden ? 'var(--color-muted-foreground)' : 'var(--color-foreground)'}
      fontSize={11}
      style={{ cursor: 'pointer', textDecoration: isHidden ? 'line-through' : undefined }}
      onClick={() => onToggle(key)}
    >
      {label}
    </text>
  )
}

export interface ArrowTickProps {
  // x/y/payload injected by recharts via the right <YAxis tick={...}> element.
  x?: number
  y?: number
  payload?: { value?: string | number }
  /** Called with the row's axis key (category / other party) on click. */
  onSelect: (key: string) => void
}

/**
 * Right-axis tick: a clickable chevron per row that drills into the filtered
 * transaction search. Rendered as a category-axis tick so it lines up exactly
 * with each bar.
 */
export function ArrowTick({ x = 0, y = 0, payload, onSelect }: ArrowTickProps) {
  const key = String(payload?.value ?? '')
  return (
    <g
      className="stats-drill-arrow"
      transform={`translate(${x}, ${y})`}
      role="button"
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(key)}
    >
      <rect x={0} y={-11} width={22} height={22} fill="transparent" />
      <path
        d="M6 -5 L11 0 L6 5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}
