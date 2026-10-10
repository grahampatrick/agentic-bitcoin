"use client"

import { useState } from "react"

type C = { slug: string; title: string; active: boolean; goalLabel: string }

export function CampaignTools({
  slug,
  token,
  campaigns,
}: { slug: string; token: string; campaigns: C[] }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    title: "",
    story: "",
    goalKind: "monthly",
    goalAmount: "",
    endsAt: "",
  })
  const [update, setUpdate] = useState({ campaign: campaigns[0]?.slug ?? "", text: "" })
  const [report, setReport] = useState({ campaign: campaigns[0]?.slug ?? "", sats: "", at: "" })

  async function post(path: string, body: unknown, done: string) {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/receive/${slug}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, ...(body as object) }),
      })
      const j = (await res.json()) as { ok: boolean; error?: string; slug?: string }
      if (!res.ok || !j.ok) throw new Error(j.error ?? "failed")
      setMsg(done + (j.slug ? ` Page: /campaigns/${j.slug}` : ""))
      if (path === "campaigns" || path === "close") setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const set =
    <T extends object>(o: T, k: keyof T, setter: (v: T) => void) =>
    (e: { target: { value: string } }) =>
      setter({ ...o, [k]: e.target.value })
  const open = campaigns.filter((c) => c.active)

  return (
    <div className="receive">
      <h2>Campaigns</h2>
      {campaigns.length ? (
        <ul className="directory">
          {campaigns.map((c) => (
            <li key={c.slug}>
              <strong>{c.title}</strong> <code>{c.slug}</code> · {c.goalLabel} ·{" "}
              {c.active ? "open" : "closed"} <a href={`/campaigns/${c.slug}`}>page</a>
              {c.active ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="demo__cancel"
                    disabled={busy}
                    onClick={() => post("close", { campaign: c.slug }, "Closed.")}
                  >
                    close
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small">
          No campaign yet. A campaign is a goal supporters can pledge to: monthly support, or a
          total for a project.
        </p>
      )}
      <h3>New campaign</h3>
      <label>
        Title
        <input
          value={form.title}
          onChange={set(form, "title", setForm)}
          maxLength={100}
          placeholder="Field support 2027"
        />
      </label>
      <label>
        Story (optional)
        <input
          value={form.story}
          onChange={set(form, "story", setForm)}
          maxLength={2000}
          placeholder="What the support makes possible."
        />
      </label>
      <label>
        Goal
        <select value={form.goalKind} onChange={set(form, "goalKind", setForm)}>
          <option value="monthly">Dollars per month</option>
          <option value="total">Total in sats</option>
        </select>
      </label>
      <label>
        {form.goalKind === "monthly" ? "Dollars per month" : "Sats"}
        <input
          value={form.goalAmount}
          onChange={set(form, "goalAmount", setForm)}
          placeholder={form.goalKind === "monthly" ? "1200" : "20000000"}
        />
      </label>
      <label>
        Ends (optional, YYYY-MM-DD)
        <input
          value={form.endsAt}
          onChange={set(form, "endsAt", setForm)}
          placeholder="2027-06-30"
        />
      </label>
      <button
        type="button"
        className="cta"
        disabled={busy}
        onClick={() => post("campaigns", { form }, "Campaign created.")}
      >
        Create campaign
      </button>
      {open.length ? (
        <>
          <h3>Post an update</h3>
          <label>
            Campaign
            <select value={update.campaign} onChange={set(update, "campaign", setUpdate)}>
              {open.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Update
            <input
              value={update.text}
              onChange={set(update, "text", setUpdate)}
              maxLength={2000}
              placeholder="Water at 40 metres."
            />
          </label>
          <button
            type="button"
            className="cta"
            disabled={busy}
            onClick={() =>
              post("updates", update, "Posted. Followers get it in chat within a minute.")
            }
          >
            Post update
          </button>
          <h3>Report a gift received outside Lightning</h3>
          <label>
            Campaign
            <select value={report.campaign} onChange={set(report, "campaign", setReport)}>
              {open.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sats
            <input
              value={report.sats}
              onChange={set(report, "sats", setReport)}
              placeholder="50000"
            />
          </label>
          <label>
            Date (optional, YYYY-MM-DD)
            <input value={report.at} onChange={set(report, "at", setReport)} />
          </label>
          <button
            type="button"
            className="demo__cancel"
            disabled={busy}
            onClick={() => post("reported", report, "Recorded as reported.")}
          >
            Record
          </button>
        </>
      ) : null}
      {msg ? <p className="small">{msg}</p> : null}
    </div>
  )
}
