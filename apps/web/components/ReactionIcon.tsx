import type { TaskIcon } from "@/lib/copy"

/** 20px line icons that pop in the reaction bubble on hover. One per rail. Decorative. */
export function ReactionIcon({ icon }: { icon: TaskIcon }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <Glyph icon={icon} />
    </svg>
  )
}

function Glyph({ icon }: { icon: TaskIcon }) {
  switch (icon) {
    case "bitcoin":
      return (
        <>
          <circle cx="10" cy="10" r="7.5" />
          <path d="M8 6.2v7.6M9.3 5.2v1M9.3 13.8v1M8 6.2h2.6a1.7 1.7 0 0 1 0 3.4H8M8 9.6h3a1.9 1.9 0 0 1 0 3.8H8" />
        </>
      )
    case "bolt":
      return <path d="M11.5 2.5 4.5 11h5l-1 6.5 7-8.5h-5z" />
    case "cart":
      return (
        <>
          <path d="M2.5 3.5h2.2l1.9 9.2h8.6l1.6-6.3H5.4" />
          <circle cx="8" cy="16" r="1.2" />
          <circle cx="14" cy="16" r="1.2" />
        </>
      )
    case "chip":
      return (
        <>
          <rect x="5" y="5" width="10" height="10" rx="1.5" />
          <rect x="8" y="8" width="4" height="4" />
          <path d="M8 2.5v2.5M12 2.5v2.5M8 15v2.5M12 15v2.5M2.5 8h2.5M2.5 12h2.5M15 8h2.5M15 12h2.5" />
        </>
      )
    case "handshake":
      return (
        <>
          <path d="M2.5 8.5 6 5.5h3l3 2.5-2 2a1.3 1.3 0 0 1-1.8 0L7 8.8" />
          <path d="M17.5 8.5 14 5.5h-2M9 8.6l3.6 3.4a1.2 1.2 0 0 1-1.7 1.7l-.6-.6M10.9 13.7l-.9.9a1.2 1.2 0 0 1-1.7-1.7l.4-.4M8.3 14.6a1.2 1.2 0 0 1-1.7-1.7l.6-.6" />
        </>
      )
  }
}
