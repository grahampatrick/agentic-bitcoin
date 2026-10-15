"use client"

import { useEffect, useState } from "react"

type Row = {
  id: string
  number: string
  kind: string
  payerName: string
  payerContact?: string
  totalCents: number
  status: string
  dueAt?: string
  link: string
}
const usd = (c: number) => `$${(c / 100).toFixed(2)}` // money-ok: display of an integer-cent value

export function InvoiceTools({ slug, token }: { slug: string; token: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    kind: "invoice",
    payerName: "",
    payerContact: "",
    memo: "",
    dueDate: "",
    items: [{ id: 1, description: "", qty: 1, price: "" }],
  })
  const post = async (body: unknown) => {
    const res = await fetch(`/api/receive/${slug}/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, ...(body as object) }),
    })
    return res
  }
  const load = async () => {
    const j = (await (await post({})).json()) as { invoices?: Row[] }
    setRows(j.invoices ?? [])
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load()
  }, [])
  const set = (k: string, v: string) => setForm({ ...form, [k]: v })
  const setItem = (i: number, k: string, v: string | number) =>
    setForm({ ...form, items: form.items.map((it, n) => (n === i ? { ...it, [k]: v } : it)) })

  return (
    <div className="receive">
      <h2>Invoices</h2>
      {rows === null ? (
        <p className="small">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="small">None yet.</p>
      ) : (
        <ol className="demo__ledger">
          {rows.map((r) => (
            <li key={r.id} className={r.status === "paid" ? "is-succeeded" : "is-pending"}>
              <span className="demo__outcome">{r.status}</span>
              <span className="demo__summary">
                {r.number} {r.payerName} {usd(r.totalCents)}
                {r.dueAt ? ` · due ${r.dueAt.slice(0, 10)}` : ""} · <a href={r.link}>pay link</a>
              </span>
              {r.payerContact ? (
                <span className="demo__detail">Contact: {r.payerContact}</span>
              ) : null}
              {r.status === "open" || r.status === "overdue" || r.status === "expired" ? (
                <span className="demo__detail">
                  <button
                    type="button"
                    className="demo__cancel"
                    disabled={busy}
                    onClick={() => post({ action: { id: r.id, action: "mark_paid" } }).then(load)}
                  >
                    mark paid (outside Lightning)
                  </button>{" "}
                  <button
                    type="button"
                    className="demo__cancel"
                    disabled={busy}
                    onClick={() => post({ action: { id: r.id, action: "void" } }).then(load)}
                  >
                    void
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <p className="small">
        <button
          type="button"
          className="demo__cancel"
          onClick={async () => {
            const res = await post({ csv: true })
            const blob = await res.blob()
            const a = document.createElement("a")
            a.href = URL.createObjectURL(blob)
            a.download = `invoices-${slug}.csv`
            a.click()
          }}
        >
          Download CSV
        </button>
      </p>
      <h3>New invoice</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setMsg(null)
          const j = (await (await post({ create: form })).json()) as {
            ok: boolean
            error?: string
            link?: string
            number?: string
          }
          setMsg(j.ok ? `${j.number} created. Send this link: ${j.link}` : String(j.error))
          setBusy(false)
          if (j.ok) void load()
        }}
      >
        <label>
          Kind
          <select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="invoice">Invoice</option>
            <option value="request">Payment request</option>
          </select>
        </label>
        <label>
          Who pays
          <input
            value={form.payerName}
            onChange={(e) => set("payerName", e.target.value)}
            required
            maxLength={80}
          />
        </label>
        <label>
          Their email or phone (optional, sealed)
          <input value={form.payerContact} onChange={(e) => set("payerContact", e.target.value)} />
        </label>
        {form.items.map((it, i) => (
          <div
            key={`item-${it.id}`}
            style={{ display: "grid", gridTemplateColumns: "1fr 4rem 6rem", gap: 8 }}
          >
            <label>
              Description
              <input
                value={it.description}
                onChange={(e) => setItem(i, "description", e.target.value)}
                required
              />
            </label>
            <label>
              Qty
              <input
                type="number"
                min={1}
                value={it.qty}
                onChange={(e) => setItem(i, "qty", Number(e.target.value))}
              />
            </label>
            <label>
              Price (USD)
              <input
                value={it.price}
                onChange={(e) => setItem(i, "price", e.target.value)}
                placeholder="99.50"
                required
              />
            </label>
          </div>
        ))}
        <p className="small">
          <button
            type="button"
            className="demo__cancel"
            onClick={() =>
              setForm({
                ...form,
                items: [...form.items, { id: Date.now(), description: "", qty: 1, price: "" }],
              })
            }
          >
            + item
          </button>
        </p>
        <label>
          Memo (optional)
          <input value={form.memo} onChange={(e) => set("memo", e.target.value)} maxLength={200} />
        </label>
        <label>
          Due (YYYY-MM-DD, optional)
          <input value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </label>
        <button type="submit" className="cta" disabled={busy}>
          Create invoice
        </button>
        {msg ? <p className="small">{msg}</p> : null}
      </form>
    </div>
  )
}
