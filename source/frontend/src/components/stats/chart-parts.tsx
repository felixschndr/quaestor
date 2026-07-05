import { formatEuro } from '@/lib/format'

// Roughly the width one character of the label needs, used to decide whether the
// value fits inside its bar.
const APPROX_CHAR_WIDTH = 6.5

// Left edge shared by every axis label so all charts line up with the card
// title/icon (which sits at the content-left edge). 0 = flush with the icon.
export const AXIS_LABEL_LEFT = 0

// Width reserved for the drill-arrow axis. The chevron right-anchors to this
// band's right edge, so with the chart's right margin at 0 it lands flush
// against the card's content edge — as far right as the padding allows, with no
// per-chart pixel tuning.
export const DRILL_ARROW_WIDTH = 16

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
      x={AXIS_LABEL_LEFT}
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

export interface AxisValueTickProps {
  x?: number
  y?: number
  payload?: { value?: string | number }
  format: (value: unknown) => string
}

export function AxisValueTick({ x = 0, y = 0, payload, format }: AxisValueTickProps) {
  return (
    <text
      x={x}
      y={y}
      dx={-4}
      dy="0.32em"
      textAnchor="end"
      fill="var(--color-foreground)"
      fontSize={11}
    >
      {format(payload?.value)}
    </text>
  )
}

export interface ArrowTickProps {
  x?: number
  y?: number
  payload?: { value?: string | number }
  onSelect: (key: string) => void
}

function DrillChevronPath({ transform }: { transform?: string }) {
  return (
    <path
      d="M0 -5 L5 0 L0 5"
      transform={transform}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

export function DrillArrowIcon({ className }: { className?: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true" className={className}>
      <DrillChevronPath transform="translate(6.5, 9)" />
    </svg>
  )
}

const CHEVRON_WIDTH = 5
const CHEVRON_TIP_INSET = 2

export function ArrowTick({ x = 0, y = 0, payload, onSelect }: ArrowTickProps) {
  const key = String(payload?.value ?? '')
  const chevronX = DRILL_ARROW_WIDTH - CHEVRON_WIDTH - CHEVRON_TIP_INSET
  return (
    <g
      className="stats-drill-arrow"
      transform={`translate(${x}, ${y})`}
      role="button"
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(key)}
    >
      <rect x={-10} y={-11} width={DRILL_ARROW_WIDTH + 10} height={22} fill="transparent" />
      <DrillChevronPath transform={`translate(${chevronX}, 0)`} />
    </g>
  )
}
