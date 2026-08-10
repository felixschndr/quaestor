import { DrillArrowIcon } from '@/components/stats/chart-parts'

export interface StatMetricData {
  label: string
  value: string
  onDrill?: () => void
  drillLabel?: string
}

function DrillButton({ onDrill, label }: { onDrill: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onDrill}
      aria-label={label}
      className="stats-drill-arrow -m-1 inline-flex items-center rounded-md p-1"
    >
      <DrillArrowIcon />
    </button>
  )
}

export function StatMetric({ label, value, onDrill, drillLabel }: StatMetricData) {
  return (
    <div className="bg-muted/50 flex flex-col items-center gap-0.5 rounded-md p-3 text-center">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="inline-flex items-center gap-1 truncate text-base font-semibold tabular-nums">
        {value}
        {onDrill && <DrillButton onDrill={onDrill} label={drillLabel} />}
      </span>
    </div>
  )
}

export function StatMetricGroup({ metrics }: { metrics: StatMetricData[] }) {
  return (
    <>
      <dl className="flex flex-col gap-2 text-sm sm:hidden">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">{metric.label}</dt>
            <dd className="inline-flex items-center gap-1 font-semibold tabular-nums">
              {metric.value}
              {metric.onDrill && <DrillButton onDrill={metric.onDrill} label={metric.drillLabel} />}
            </dd>
          </div>
        ))}
      </dl>
      <div
        className="hidden gap-2 sm:grid"
        style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }}
      >
        {metrics.map((metric) => (
          <StatMetric key={metric.label} {...metric} />
        ))}
      </div>
    </>
  )
}
