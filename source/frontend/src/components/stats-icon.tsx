export function StatsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Axis — stays put. */}
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      {/* Bars, left to right. */}
      <line className="stats-icon-bar stats-icon-bar-1" x1="8" y1="17" x2="8" y2="14" />
      <line className="stats-icon-bar stats-icon-bar-2" x1="13" y1="17" x2="13" y2="5" />
      <line className="stats-icon-bar stats-icon-bar-3" x1="18" y1="17" x2="18" y2="9" />
    </svg>
  )
}
