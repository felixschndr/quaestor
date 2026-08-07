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

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * 100,
    y: span === 0 ? 20 : 38 - ((value - min) / span) * 36,
  }))
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
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
      />
    </svg>
  )
}
