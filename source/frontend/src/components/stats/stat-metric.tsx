export function StatMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 flex flex-col items-center gap-0.5 rounded-md p-3 text-center">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="truncate text-base font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export function StatMetricGroup({ metrics }: { metrics: { label: string; value: string }[] }) {
  return (
    <>
      <dl className="flex flex-col gap-2 text-sm sm:hidden">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">{metric.label}</dt>
            <dd className="font-semibold tabular-nums">{metric.value}</dd>
          </div>
        ))}
      </dl>
      <div className="hidden grid-cols-3 gap-2 sm:grid">
        {metrics.map((metric) => (
          <StatMetric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>
    </>
  )
}
