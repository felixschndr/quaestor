import type { ComponentPropsWithoutRef } from 'react'

export function NotificationLogIcon({ className, ...props }: ComponentPropsWithoutRef<'svg'>) {
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
      {...props}
    >
      <g transform="translate(-0.5 -0.5) scale(0.85)" strokeWidth="2.35">
        <g className="notification-bell">
          <path d="M10.268 21a2 2 0 0 0 3.464 0" />
          <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
        </g>
      </g>
      <circle cx="17.4" cy="17.4" r="6.1" fill="var(--color-background)" stroke="none" />
      <circle cx="17.4" cy="17.4" r="4.6" />
      <path d="M17.4 15v2.4l1.6 1" />
    </svg>
  )
}
