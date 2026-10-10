"use client"

import { useState } from "react"

type Result = {
  ok: boolean
  error?: string
  slug?: string
  lightningAddress?: string
  dashboardToken?: string
  verified?: boolean
  warning?: string
}

export function ReceiveForm({ baseUrl }: { baseUrl: string }) {
  const [method, setMethod] = useState<"address" | "nwc">("address")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [form, setForm] = useState({
    name: "",
    kind: "church",
    website: "",
    country: "",
    description: "",
    contact: "",
    lightningAddress: "",
    nwc: "",
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault()
    setBusy(true)
    setResult(null)
    try {
      const body = {
        ...form,
        lightningAddress: method === "address" ? form.lightningAddress : "",
        nwc: method === "nwc" ? form.nwc : "",
      }
      const res = await fetch("/api/receive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      setResult((await res.json()) as Result)
      if (res.ok) setForm({ ...form, nwc: "" })
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (result?.ok && result.slug) {
    const dash = `${baseUrl}/receive/${result.slug}?t=${result.dashboardToken}`
    const snippet = `<a href="${baseUrl}/tip/${result.slug}"><img src="${baseUrl}/api/tip-badge/${result.slug}" alt="Tip in bitcoin" height="32"></a>`
    return (
      <div className="receive__done">
        <h2>You can receive.</h2>
        <p>
          Lightning address: <code>{result.lightningAddress}</code>
        </p>
        <p>
          Give page:{" "}
          <a href={`/give/${result.slug}`}>
            {baseUrl}/give/{result.slug}
          </a>
          <br />
          Tip page:{" "}
          <a href={`/tip/${result.slug}`}>
            {baseUrl}/tip/{result.slug}
          </a>
        </p>
        <p>
          <strong>Save this dashboard link now; it is shown once:</strong>
          <br />
          <code>{dash}</code>
        </p>
        <p>Tip button for your site:</p>
        <pre className="receive__snippet">{snippet}</pre>
        <p className="small">
          {result.verified
            ? "Your address is on your own domain, so you are verified and listed."
            : "You are not listed yet: we confirm the address with you directly, then verify. Your pages and address work right away for anyone you send them to."}
          {result.warning ? ` ${result.warning}` : ""}
        </p>
      </div>
    )
  }

  return (
    <form className="receive" onSubmit={submit}>
      <label>
        Name
        <input
          value={form.name}
          onChange={set("name")}
          required
          maxLength={80}
          placeholder="Grace Fellowship Church"
        />
      </label>
      <label>
        What are you
        <select value={form.kind} onChange={set("kind")}>
          <option value="church">Church</option>
          <option value="missionary">Missionary</option>
          <option value="creator">Creator / individual</option>
          <option value="merchant">Merchant</option>
        </select>
      </label>
      <label>
        Website (https)
        <input
          value={form.website}
          onChange={set("website")}
          placeholder="https://grace-fellowship.org"
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
          maxLength={300}
          placeholder="A church in Denver, Colorado."
        />
      </label>
      <label>
        How we can reach you to verify (email or Signal number)
        <input value={form.contact} onChange={set("contact")} maxLength={120} />
      </label>
      <fieldset className="receive__method">
        <legend>How you get paid</legend>
        <label>
          <input
            type="radio"
            checked={method === "address"}
            onChange={() => setMethod("address")}
          />{" "}
          I have a Lightning address
        </label>
        <label>
          <input type="radio" checked={method === "nwc"} onChange={() => setMethod("nwc")} />{" "}
          Connect my own wallet (receive-only)
        </label>
        {method === "address" ? (
          <input
            value={form.lightningAddress}
            onChange={set("lightningAddress")}
            placeholder="give@grace-fellowship.org"
            required
          />
        ) : (
          <>
            <input
              value={form.nwc}
              onChange={set("nwc")}
              placeholder="nostr+walletconnect://…"
              required
              autoComplete="off"
            />
            <p className="small">
              In Alby Hub, Coinos or Zeus create a connection that may <strong>only</strong> create
              and look up invoices (no pay permission). We refuse anything that can spend, and we
              store the string encrypted.
            </p>
          </>
        )}
      </fieldset>
      <button type="submit" className="cta" disabled={busy}>
        {busy ? "Checking…" : "Create my give page"}
      </button>
      {result && !result.ok ? <p className="give__err">{result.error}</p> : null}
    </form>
  )
}
