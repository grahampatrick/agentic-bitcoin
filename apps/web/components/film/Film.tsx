"use client"

import { AnvardMark } from "@/components/Logo"
import { type Beat, SCENES, type Scene, holdFor } from "@/lib/film/scenes"
import { useEffect, useMemo, useRef, useState } from "react"

const sats = (n: number) => n.toLocaleString("en-US") // money-ok: display of a scripted number

/** Reveals `text` a character at a time, the way a person types, then hands over. */
function Typed({ text, ms, instant }: { text: string; ms: number; instant: boolean }) {
  const [n, setN] = useState(instant ? text.length : 0)
  useEffect(() => {
    if (instant) return
    const step = Math.max(12, ms / Math.max(1, text.length))
    const id = setInterval(() => setN((k) => (k >= text.length ? k : k + 1)), step)
    return () => clearInterval(id)
  }, [text, ms, instant])
  return <>{text.slice(0, n)}</>
}

/** Counts a number from its previous value to the next one over a short beat. */
function Counter({ value, instant }: { value: number; instant: boolean }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (instant) {
      setShown(value)
      return
    }
    const start = from.current
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700)
      const e = 1 - (1 - p) ** 3
      setShown(Math.round(start + (value - start) * e))
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, instant])
  return <>{sats(shown)}</>
}

function Bolt() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="film__bolt">
      <path d="M13.5 2 5 13.5h6L9.5 22 19 10.5h-6z" fill="currentColor" />
    </svg>
  )
}

interface Playback {
  shown: number
  instant: boolean
}

/** One scene on the phone. Everything derives from how many beats are shown. */
function Phone({ scene, shown, instant }: { scene: Scene } & Playback) {
  const beats = scene.beats.slice(0, shown)
  const cardBeat = beats.find((b) => b.kind === "card")
  const limitOpen = (() => {
    let open = false
    for (const b of beats) {
      if (b.kind === "limit") open = true
      if (b.kind === "close") open = false
    }
    return open
  })()
  const items = beats.filter((b): b is Extract<Beat, { kind: "item" }> => b.kind === "item")
  const spent = items.reduce((n, i) => n + i.sats, 0)
  const limit = beats.find((b): b is Extract<Beat, { kind: "limit" }> => b.kind === "limit")
  const sheet =
    shown > 0 && scene.beats[shown - 1]?.kind === "sheet" ? scene.beats[shown - 1] : null
  const approved = new Set(
    beats
      .filter((b): b is Extract<Beat, { kind: "approve" }> => b.kind === "approve")
      .map((b) => b.id),
  )
  const status = [...beats].reverse().find((b) => b.kind === "status")
  const statusLive = status && scene.beats[shown - 1]?.kind === "status"
  const logRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll the log on every new beat
  useEffect(() => {
    logRef.current?.scrollTo({
      top: logRef.current.scrollHeight,
      behavior: instant ? "auto" : "smooth",
    })
  }, [shown])

  return (
    <div className={`film__phone is-${scene.theme}`} aria-live="polite">
      <div className="film__statusbar">
        <span>9:41</span>
        <span className="film__signal" aria-hidden="true">
          <i />
          <i />
          <i />
          <b />
        </span>
      </div>
      <div className="film__header">
        <AnvardMark className="film__mark" />
        <span className="film__brand">Anvard</span>
        {statusLive && status?.kind === "status" ? (
          <span className="film__status">
            <span className="film__dot" />
            {status.text}
          </span>
        ) : null}
      </div>
      <div className="film__log" ref={logRef}>
        {beats.map((b, i) => {
          const key = `${i}-${b.kind}`
          const last = i === shown - 1
          switch (b.kind) {
            case "you":
              return (
                <p key={key} className="film__msg is-you">
                  <Typed text={b.text} ms={holdFor(b) - 700} instant={instant || !last} />
                </p>
              )
            case "bot":
              return (
                <p key={key} className="film__msg is-bot">
                  {b.text}
                </p>
              )
            case "card": {
              const made = shown - 1 > i
              return (
                <div key={key} className={`film__card${made ? " is-made" : ""}`}>
                  <span className="film__cardhead">
                    <Bolt />
                    {made ? "Card made" : "Make a card"}
                  </span>
                  <strong>{b.name}</strong>
                  <span className="film__cardlimit">
                    Limit {sats(b.limitSats)} sats <em>{b.usd}</em>
                  </span>
                </div>
              )
            }
            case "order": {
              const ok = approved.has(b.id)
              return (
                <div key={key} className={`film__order${ok ? " is-approved" : ""}`}>
                  <span className="film__orderamt">
                    {sats(b.sats)} sats <em>{b.usd}</em>
                    <b>{ok ? "Approved" : "Needs your yes"}</b>
                  </span>
                  <span className="film__ordermerchant">{b.merchant}</span>
                  <span className="film__orderline">
                    <small>Order summary</small>
                    {b.line}
                  </span>
                </div>
              )
            }
            default:
              return null
          }
        })}
      </div>
      <div className="film__compose" aria-hidden="true">
        <span>Message</span>
      </div>

      {limitOpen && limit ? (
        <div className="film__limit">
          <div className="film__limithead">
            <small>Left on the {cardBeat?.kind === "card" ? cardBeat.name : ""} card</small>
            <strong>
              <Counter value={limit.limitSats - spent} instant={instant} /> sats
            </strong>
            <span>
              of {sats(limit.limitSats)} · {limit.usd}
            </span>
          </div>
          <ul className="film__items">
            {items.map((it) => (
              <li key={it.text}>
                <span className="film__emoji" aria-hidden="true">
                  {it.emoji}
                </span>
                <span>
                  {it.text} <b>{sats(it.sats)} sats</b> <em>{it.usd}</em>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {sheet?.kind === "sheet" ? (
        <div className="film__sheet">
          <span className="film__sheethead">
            <Bolt /> anvard
          </span>
          <span className="film__sheetpill">
            {sheet.text} <i>✓</i>
          </span>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Plays the scenes beat by beat on a timer. With reduced motion, or after the viewer presses
 * "show all", every beat is on the stage at once.
 */
export function Film({ initial = SCENES[0]?.slug }: { initial?: string }) {
  const [slug, setSlug] = useState(initial)
  const scene = useMemo(() => SCENES.find((s) => s.slug === slug) ?? SCENES[0], [slug])
  const [shown, setShown] = useState(0)
  const [instant, setInstant] = useState(false)
  const [run, setRun] = useState(0)

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduce) setInstant(true)
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new run or scene restarts the timer
  useEffect(() => {
    if (!scene) return
    if (instant) {
      setShown(scene.beats.length)
      return
    }
    setShown(0)
    let i = 0
    let id: ReturnType<typeof setTimeout>
    const next = () => {
      i += 1
      setShown(i)
      const b = scene.beats[i - 1]
      if (!b || b.kind === "done" || i >= scene.beats.length) return
      id = setTimeout(next, holdFor(b))
    }
    id = setTimeout(next, 600)
    return () => clearTimeout(id)
  }, [scene, run, instant])

  if (!scene) return null
  const finished = shown >= scene.beats.length
  return (
    <div className="film">
      <div className="film__stage">
        <Phone scene={scene} shown={shown} instant={instant} />
      </div>
      <div className="film__controls">
        <div className="film__tabs" role="tablist" aria-label="Scenes">
          {SCENES.map((s) => (
            <button
              key={s.slug}
              type="button"
              role="tab"
              aria-selected={s.slug === scene.slug}
              className={s.slug === scene.slug ? "is-on" : ""}
              onClick={() => {
                setSlug(s.slug)
                setRun((r) => r + 1)
              }}
            >
              {s.title}
            </button>
          ))}
        </div>
        <p className="film__tagline">{scene.tagline}</p>
        <div className="film__buttons">
          <button type="button" className="cta" onClick={() => setRun((r) => r + 1)}>
            {finished ? "Play again" : "Restart"}
          </button>
          {!instant ? (
            <button type="button" className="film__link" onClick={() => setInstant(true)}>
              Show it all at once
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
