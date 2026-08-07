export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="border-border bg-card flex flex-col rounded-lg border" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li
          key={index}
          className="border-border/40 flex flex-col gap-2 border-t p-3 first:border-t-0"
        >
          <span className="bg-muted block h-4 w-1/3 animate-pulse rounded-md" />
          <span className="bg-muted block h-3 w-2/3 animate-pulse rounded-md" />
        </li>
      ))}
    </ul>
  )
}
