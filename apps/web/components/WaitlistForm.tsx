"use client"

import { useState } from "react"

type Status = "idle" | "submitting" | "ok" | "error"

export function WaitlistForm({ source = "text" }: { source?: "landing" | "text" }) {
  const [contact, setContact] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [message, setMessage] = useState("")

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus("submitting")
    setMessage("")
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact, source }),
      })
      const data = (await res.json()) as { ok?: boolean; kind?: string; error?: string }
      if (res.ok) {
        setStatus("ok")
        setMessage(
          data.kind === "npub"
            ? "You're on the list. We'll DM your npub when texting opens."
            : "You're on the list. One email when texting opens.",
        )
        setContact("")
      } else {
        setStatus("error")
        setMessage(data.error ?? "Something went wrong. Try again.")
      }
    } catch {
      setStatus("error")
      setMessage("Network hiccup — try again in a moment.")
    }
  }

  return (
    <form className="waitlist" onSubmit={onSubmit} noValidate>
      <label className="waitlist__label" htmlFor="contact">
        Email or npub
      </label>
      <div className="waitlist__row">
        <input
          id="contact"
          type="text"
          inputMode="email"
          autoComplete="email"
          placeholder="you@email.com or npub1…"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          required
          disabled={status === "submitting"}
        />
        <button className="cta" type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Adding…" : "Join the list"}
          <span className="cta__chevron" aria-hidden="true">
            <Chevron />
          </span>
        </button>
      </div>
      {message ? (
        <output className={`waitlist__msg ${status === "ok" ? "is-ok" : "is-error"}`}>
          {message}
        </output>
      ) : null}
    </form>
  )
}

export function Chevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.5 4.5 13 10l-5.5 5.5" />
    </svg>
  )
}
