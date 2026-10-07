/**
 * Our mark: a hand-drawn stick figure holding up a coin. Line-drawn in the spirit of a
 * doodle, deliberately not Instinct's stickman (ADR-0002). Width is set by CSS.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 28 74"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <title>Agentic Bitcoin</title>
      {/* head */}
      <circle cx="13.5" cy="9" r="5.2" />
      {/* spine */}
      <path d="M13.5 14.5 C13.2 24 13.8 32 13.5 42" />
      {/* left arm, down */}
      <path d="M13.5 20 C9.5 25 7.5 29 6 34" />
      {/* right arm, raised, holding the coin */}
      <path d="M13.5 19 C17 15 20 12 22.5 8.5" />
      {/* the coin */}
      <circle cx="23.6" cy="6" r="3.6" />
      <path
        d="M22.6 4.2 v3.6 M22.6 4.6 h1.3 a0.8 0.8 0 0 1 0 1.6 h-1.3 M22.6 6.2 h1.5 a0.8 0.8 0 0 1 0 1.6 h-1.5"
        strokeWidth="1"
      />
      {/* legs */}
      <path d="M13.5 42 C11 50 8.5 58 6.5 66" />
      <path d="M13.5 42 C16.5 50 19 58 21.5 66" />
      {/* feet */}
      <path d="M6.5 66 L3.5 68.5" />
      <path d="M21.5 66 L24.8 68" />
    </svg>
  )
}
