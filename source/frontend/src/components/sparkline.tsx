import { cn } from '@/lib/utils'

interface Point {
  x: number
  y: number
}

const round = (value: number) => value.toFixed(2)

function smoothPath(points: Point[]): string {
  const first = points[0]
  const last = points[points.length - 1]
  const curves = points.slice(1, -1).map((point, index) => {
    const next = points[index + 2]
    const midX = (point.x + next.x) / 2
    const midY = (point.y + next.y) / 2
    return `Q${round(point.x)},${round(point.y)} ${round(midX)},${round(midY)}`
  })
  return `M${round(first.x)},${round(first.y)} ${curves.join(' ')} L${round(last.x)},${round(last.y)}`
}

export function Sparkline({
  values,
  className,
  activeIndex,
}: {
  values: number[]
  className?: string
  activeIndex?: number | null
}) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * 100,
    y: span === 0 ? 20 : 38 - ((value - min) / span) * 36,
  }))
  const active = markerAt(points, activeIndex)
  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="block h-full w-full"
        role="presentation"
      >
        <path
          d={smoothPath(points)}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          strokeOpacity={active ? 0.35 : 1}
        />
      </svg>
      {active ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current"
          style={{
            left: `${round(active.x)}%`,
            top: `${round((active.y / 40) * 100)}%`,
            boxShadow: '0 0 0 2px var(--color-background), 0 0 0 4px currentColor',
          }}
        />
      ) : null}
    </div>
  )
}

// The line is smoothed through the segment midpoints, so a vertex is a Bézier control point that
// sits slightly off the drawn curve. Return the point actually ON the curve at the vertex's x:
// exact at the ends, and the quadratic's t=0.5 value (0.75 vertex + 0.125 each neighbour) between.
function markerAt(points: Point[], index: number | null | undefined): Point | null {
  if (index == null || index < 0 || index >= points.length) return null
  const point = points[index]
  if (index === 0 || index === points.length - 1) return point
  return { x: point.x, y: 0.75 * point.y + 0.125 * (points[index - 1].y + points[index + 1].y) }
}
