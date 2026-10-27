const s = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const
export const Icon = {
  home: () => (
    <svg {...s} aria-hidden="true">
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
  link: () => (
    <svg {...s} aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  ),
  ticket: () => (
    <svg {...s} aria-hidden="true">
      <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6z" />
      <path d="M13 5v14" strokeDasharray="2 2" />
    </svg>
  ),
  invoice: () => (
    <svg {...s} aria-hidden="true">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  ),
  repeat: () => (
    <svg {...s} aria-hidden="true">
      <path d="M4 7h11l-3-3" />
      <path d="M20 17H9l3 3" />
      <path d="M4 7v4M20 17v-4" />
    </svg>
  ),
  inbox: () => (
    <svg {...s} aria-hidden="true">
      <path d="M3 13l2-8h14l2 8v6H3z" />
      <path d="M3 13h6a3 3 0 0 0 6 0h6" />
    </svg>
  ),
  pos: () => (
    <svg {...s} aria-hidden="true">
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M9 7h6M9 11h2M13 11h2M9 15h2M13 15h2" />
    </svg>
  ),
  checkout: () => (
    <svg {...s} aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h6v6h-6z" strokeDasharray="2 2" />
    </svg>
  ),
  check: () => (
    <svg {...s} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  ),
  bolt: () => (
    <svg {...s} aria-hidden="true">
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
  contact: () => (
    <svg {...s} aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7 18a5 5 0 0 1 10 0" />
    </svg>
  ),
  plug: () => (
    <svg {...s} aria-hidden="true">
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 18v3" />
    </svg>
  ),
  gear: () => (
    <svg {...s} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.3.9a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.4a7 7 0 0 0-1.7 1L5.1 5.5l-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.3-.9a7 7 0 0 0 1.7 1l.4 2.4h5l.4-2.4a7 7 0 0 0 1.7-1l2.3.9 2-3.5-2-1.5c.1-.3.1-.7.1-1z" />
    </svg>
  ),
  help: () => (
    <svg {...s} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.2" />
      <path d="M12 17h.01" />
    </svg>
  ),
}
