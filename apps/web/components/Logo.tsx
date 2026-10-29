import { useId } from "react"

/**
 * The Anvard marks (ADR-0026). Two original drawings, nothing traced:
 *
 * - `AnvardMark`: an ornate capital A, red with a gold bevel and a gold inline, in the manner of
 *   an illuminated initial. The bevel, inline and shadow are an SVG filter over one red fill, so
 *   the legs and the crossbar read as a single cast letter with no seams.
 * - `Castle`: a line-drawn castle on a rocky hill, in the same doodle hand as the rest of the
 *   site, in `currentColor`.
 *
 * `Logo` is the header lockup: the A beside the castle. Height is set by CSS.
 */

export function AnvardMark({
  className,
  title = "Anvard",
}: { className?: string; title?: string }) {
  const id = useId()
  const red = `${id}-red`
  const ornate = `${id}-ornate`
  return (
    <svg
      className={className}
      viewBox="0 0 250 236"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <title>{title}</title>
      <defs>
        <radialGradient id={red} cx="0.5" cy="0.48" r="0.62">
          <stop offset="0" stopColor="#e8393e" />
          <stop offset="0.55" stopColor="#b6151d" />
          <stop offset="1" stopColor="#6b0a10" />
        </radialGradient>
        <filter
          id={ornate}
          x="-12%"
          y="-12%"
          width="124%"
          height="124%"
          colorInterpolationFilters="sRGB"
        >
          {/* outer bevel: a dark gold band, then a bright gold band inside it */}
          <feMorphology in="SourceAlpha" operator="dilate" radius="5" result="outer" />
          <feFlood floodColor="#6f4b0f" result="darkGold" />
          <feComposite in="darkGold" in2="outer" operator="in" result="outerBand" />
          <feMorphology in="SourceAlpha" operator="dilate" radius="3" result="mid" />
          <feFlood floodColor="#e7bf55" result="gold" />
          <feComposite in="gold" in2="mid" operator="in" result="midBand" />
          {/* inline: a hairline of pale gold set just inside the edge */}
          <feMorphology in="SourceAlpha" operator="erode" radius="3.2" result="inA" />
          <feMorphology in="SourceAlpha" operator="erode" radius="4.6" result="inB" />
          <feComposite in="inA" in2="inB" operator="out" result="ring" />
          <feFlood floodColor="#f7d97c" result="paleGold" />
          <feComposite in="paleGold" in2="ring" operator="in" result="inline" />
          {/* a soft cast shadow under the whole letter */}
          <feGaussianBlur in="outer" stdDeviation="2.5" result="blur" />
          <feOffset in="blur" dx="2" dy="4" result="shadowShape" />
          <feFlood floodColor="#000" floodOpacity="0.45" result="black" />
          <feComposite in="black" in2="shadowShape" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="outerBand" />
            <feMergeNode in="midBand" />
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="inline" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${ornate})`} fill={`url(#${red})`} transform="translate(6 6)">
        {/* legs: a thin left stroke, a heavy right stroke, flared pointed feet, a horned apex */}
        <path d="M120 0 L136 22 L212 182 Q222 186 236 198 Q198 186 158 204 Q168 190 176 182 L112 60 L62 182 Q72 192 84 204 Q44 186 14 198 Q28 186 40 182 L102 28 Q96 16 88 6 Q104 10 112 14 Z" />
        {/* crossbar: slanted, with a nick cut into its underside */}
        <path d="M70 122 L170 134 L170 152 L126 148 L120 141 L114 147 L70 140 Z" />
      </g>
    </svg>
  )
}

export function Castle({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 160 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* the hill, its hatching and two rocks */}
      <path d="M2 114 C18 103 28 97 40 93 C58 90 70 95 82 93 C100 91 112 96 126 94 C140 97 150 105 158 114" />
      <path d="M8 113 C16 108 24 105 32 103 M18 115 C26 110 32 108 40 107 M30 116 C36 112 42 111 48 110 M58 101 C66 99 72 101 78 100 M64 106 C72 104 80 106 88 105 M92 101 C100 100 106 102 112 101 M116 106 C126 105 134 108 142 112 M126 115 C134 111 142 111 150 115 M136 101 C142 101 146 104 150 108" />
      <path d="M44 112 C48 108 54 108 58 112 M98 112 C102 108 108 108 112 112" />
      {/* left round tower: conical roof, pennant, band, slit windows, stone ticks */}
      <path d="M28 92 C28 74 28 56 28 40 M46 92 C46 74 46 56 46 40 M28 46 C34 44 40 44 46 46" />
      <path d="M24 40 C28 32 32 24 37 14 C42 24 46 32 50 40 Z M37 14 L37 4 L45 7 L37 10" />
      <path d="M35 60 L35 66 M39 60 L39 66 M35 78 L35 84 M39 78 L39 84 M31 52 L33 52 M41 56 L43 56 M30 70 L32 70 M42 72 L44 72 M33 88 L35 88" />
      {/* curtain walls with crenellations, either side of the keep */}
      <path d="M46 72 L50 72 L50 66 L55 66 L55 72 L60 72 L60 66 L66 66 M94 66 L99 66 L99 72 L104 72 L104 66 L109 66 L109 72 L112 72" />
      <path d="M52 80 L55 80 M58 86 L61 86 M100 80 L103 80 M106 86 L109 86" />
      {/* gate and portcullis */}
      <path d="M74 93 L74 82 Q80 74 86 82 L86 93 M80 77 L80 93 M76 84 L84 84 M76 89 L84 89" />
      {/* the keep, with battlements and arched windows */}
      <path d="M66 72 L66 44 L70 44 L70 38 L75 38 L75 44 L85 44 L85 38 L90 38 L90 44 L94 44 L94 72" />
      <path d="M71 56 L71 62 M77 50 L77 56 M83 50 L83 56 M89 56 L89 62 M68 66 L70 66 M91 50 L93 50" />
      {/* the tall inner tower above the keep, with the highest pennant */}
      <path d="M74 44 L74 24 M86 44 L86 24 M71 24 C74 18 77 13 80 8 C83 13 86 18 89 24 Z M80 8 L80 2 L87 4 L80 6 M78 32 L78 37 M82 32 L82 37" />
      {/* right square tower with a corner turret */}
      <path d="M112 92 L112 50 L116 50 L116 44 L121 44 L121 50 L127 50 L127 44 L132 44 L132 50 L136 50 L136 92" />
      <path d="M120 62 L120 68 M128 62 L128 68 M124 76 L124 82 M114 58 L116 58 M133 70 L135 70 M115 86 L117 86" />
      <path d="M133 50 L133 34 M141 50 L141 34 M131 34 C133 30 135 27 137 23 C139 27 141 30 143 34 Z M137 23 L137 16 L143 18 L137 20 M141 50 L138 55" />
    </svg>
  )
}

/** The header lockup: the ornate A beside the castle. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={className}>
      <AnvardMark className="logo__mark" />
      <Castle className="logo__castle" />
    </span>
  )
}
