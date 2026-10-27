"use client"

import { useState } from "react"

export function ProfileForm(p: {
  slug: string
  token: string
  name: string
  website?: string
  country?: string
  description?: string
}) {
  const [form, setForm] = useState({
    name: p.name,
    website: p.website ?? "",
    country: p.country ?? "",
    description: p.description ?? "",
  })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await fetch(`/api/receive/${p.slug}/profile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: p.token, ...form }),
    })
    const j = (await res.json()) as { ok: boolean; error?: string }
    setBusy(false)
    setMsg(
      j.ok
        ? { ok: true, text: "Saved. Your pages and the directory show the new profile." }
        : { ok: false, text: j.error ?? "Could not save." },
    )
    if (j.ok) setTimeout(() => window.location.reload(), 900)
  }
  return (
    <form className="mp__form" onSubmit={save}>
      <label>
        Name
        <input value={form.name} onChange={set("name")} maxLength={80} required />
      </label>
      <label>
        Website (https)
        <input
          value={form.website}
          onChange={set("website")}
          placeholder="https://your-shop.example"
        />
      </label>
      <label>
        Country (2 letters)
        <input value={form.country} onChange={set("country")} maxLength={2} placeholder="US" />
      </label>
      <label>
        One line about you
        <input
          value={form.description}
          onChange={set("description")}
          maxLength={200}
          placeholder="Singles and sealed. Denver."
        />
      </label>
      <div className="mp__form-actions">
        <button type="submit" className="mp__btn mp__btn--solid" disabled={busy}>
          Save profile
        </button>
        {msg ? <span className={msg.ok ? "mp__ok" : "mp__err"}>{msg.text}</span> : null}
      </div>
      <p className="mp__muted">
        Your slug, Lightning address and verification stay as they are; those go through the
        operator.
      </p>
    </form>
  )
}
