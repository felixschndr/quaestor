export function ContractIcon({ className }: { className?: string }) {
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
      {/* Calendar body + clock face — stay put. */}
      <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h5" />
      <circle cx="16" cy="16" r="6" />
      {/* Clock hand — spins around the clock centre (16,16) on hover. */}
      <path
        d="M18 17 16 16.3V14"
        className="origin-[16px_16px] transition-transform duration-700 ease-in-out group-hover:rotate-[360deg] [transform-box:view-box]"
      />
    </svg>
  )
}
