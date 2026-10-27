"use client"

import { VirtualCardFace } from "@/components/VirtualCardFace"
import { useMemo, useState } from "react"

export interface CardBuilderProps {
  /** Verified stores, for the "a store" scope chips. */
  shops: { slug: string; name: string }[]
  /** Integer sats per dollar for the hint under the limit field; null when the price is unknown. */
  satsPerDollar: number | null
  /** The day the preview says the budget resets (server clock, so the preview matches the real card). */
  resetsAtFor: Record<number, string>
}

type Preset = {
  key: string
  label: string
  scope: string[]
  hint: string
}

const PRESETS: Preset[] = [
  {
    key: "steam",
    label: "Steam",
    scope: ["product:steam", "merchant:bitrefill"],
    hint: "Steam gift cards through Bitrefill.",
  },
  {
    key: "gaming",
    label: "Gaming cards",
    scope: [
      "product:steam",
      "product:playstation",
      "product:xbox",
      "product:nintendo",
      "merchant:bitrefill",
    ],
    hint: "Steam, PlayStation, Xbox and Nintendo cards.",
  },
  {
    key: "giftcards",
    label: "Any gift card",
    scope: ["merchant:bitrefill"],
    hint: "Everything Bitrefill sells.",
  },
  { key: "apis", label: "Paid APIs", scope: ["rail:compute"], hint: "L402 paid APIs and compute." },
  {
    key: "giving",
    label: "Giving",
    scope: ["kind:give", "kind:schedule_give"],
    hint: "Gifts and recurring giving.",
  },
  { key: "all", label: "Everything", scope: ["*"], hint: "Every payment, one monthly budget." },
]

const digits = (s: string) => s.replace(/[^\d]/g, "")
const fmt = (s: string) => (s ? Number(s).toLocaleString("en-US") : "") // money-ok: display of an integer string

export function CardBuilder({ shops, satsPerDollar, resetsAtFor }: CardBuilderProps) {
  const [name, setName] = useState("Steam purchases")
  const [preset, setPreset] = useState<string>("steam")
  const [shop, setShop] = useState<string>("")
  const [custom, setCustom] = useState("")
  const [cap, setCap] = useState("50000")
  const [confirm, setConfirm] = useState("10000")
  const [perAction, setPerAction] = useState("")
  const [resetDay, setResetDay] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: string; token: string; link: string } | null>(null)

  const scope = useMemo(() => {
    if (preset === "shop" && shop) return [`shop:${shop}`]
    if (preset === "custom")
      return custom
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    return PRESETS.find((p) => p.key === preset)?.scope ?? []
  }, [preset, shop, custom])

  const usd =
    satsPerDollar && cap
      ? `≈ $${(Number(cap) / satsPerDollar).toFixed(2)} at today's price` // money-ok: a hint under the field, not money we move
      : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          scope,
          monthlyCapSats: cap,
          confirmAboveSats: confirm,
          perActionCapSats: perAction,
          resetDay,
        }),
      })
      const j = (await res.json()) as
        | { ok: true; id: string; token: string; link: string }
        | { ok: false; error: string }
      if (j.ok) setDone(j)
      else setErr(j.error)
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    const claim = `/cards claim ${done.id} ${done.token}`
    return (
      <section className="cardbuilder cardbuilder--done">
        <div className="cardbuilder__preview">
          <VirtualCardFace
            id={done.id}
            name={name}
            state="active"
            scope={scope}
            monthlyCapSats={digits(cap) || "0"}
            spentSats="0"
            resetsAt={resetsAtFor[resetDay] ?? resetsAtFor[1] ?? new Date().toISOString()}
          />
        </div>
        <div className="cardbuilder__form">
          <h2>Your card is made</h2>
          <p>
            It pays nothing yet. Attach it to your assistant from the chat you pay from, and from
            then on every matching payment counts against it.
          </p>
          <ol className="cardbuilder__steps">
            <li>
              Open your card page and keep the link. The token in it is shown once.
              <br />
              <a className="cardbuilder__link" href={done.link}>
                {done.link}
              </a>
            </li>
            <li>
              In chat, send:
              <code className="cardbuilder__claim">{claim}</code>
              <CopyButton text={claim} />
            </li>
          </ol>
          <p className="muted">
            The same link pauses the card from the web. Closing it moves nothing; nothing was ever
            put on it.
          </p>
        </div>
      </section>
    )
  }

  return (
    <form className="cardbuilder" onSubmit={submit}>
      <div className="cardbuilder__preview">
        <VirtualCardFace
          id="card_new"
          name={name || "Your card"}
          state="active"
          scope={scope}
          monthlyCapSats={digits(cap) || "0"}
          spentSats="0"
          resetsAt={resetsAtFor[resetDay] ?? resetsAtFor[1] ?? new Date().toISOString()}
        />
      </div>
      <div className="cardbuilder__form form">
        <label>
          Name
          <input
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Steam purchases"
            required
          />
        </label>
        <fieldset className="cardbuilder__scope">
          <legend>Pays</legend>
          <div className="cardbuilder__chips">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.key}
                className={preset === p.key ? "is-on" : ""}
                onClick={() => setPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
            {shops.length ? (
              <button
                type="button"
                className={preset === "shop" ? "is-on" : ""}
                onClick={() => {
                  setPreset("shop")
                  if (!shop && shops[0]) setShop(shops[0].slug)
                }}
              >
                A store
              </button>
            ) : null}
            <button
              type="button"
              className={preset === "custom" ? "is-on" : ""}
              onClick={() => setPreset("custom")}
            >
              Custom
            </button>
          </div>
          {preset === "shop" ? (
            <label>
              Store
              <select value={shop} onChange={(e) => setShop(e.target.value)}>
                {shops.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {preset === "custom" ? (
            <label>
              Scope patterns, comma separated
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="bob@coffee.example, *@church.example, shop:cardboard-castle"
              />
              <span className="cardbuilder__hint">
                A Lightning address, <code>*@domain</code>, a paid API host,{" "}
                <code>product:text</code>, <code>merchant:bitrefill</code>, <code>shop:slug</code>,{" "}
                <code>rail:goods</code>, <code>kind:pay_address</code>, or <code>*</code>.
              </span>
            </label>
          ) : (
            <span className="cardbuilder__hint">
              {preset === "shop"
                ? "Products from this store only."
                : PRESETS.find((p) => p.key === preset)?.hint}{" "}
              <code>{scope.join(", ")}</code>
            </span>
          )}
        </fieldset>
        <label>
          Monthly limit (sats)
          <input
            inputMode="numeric"
            value={fmt(cap)}
            onChange={(e) => setCap(digits(e.target.value))}
            required
          />
          {usd ? <span className="cardbuilder__hint">{usd}</span> : null}
        </label>
        <div className="cardbuilder__two">
          <label>
            Ask me above (sats, optional)
            <input
              inputMode="numeric"
              value={fmt(confirm)}
              onChange={(e) => setConfirm(digits(e.target.value))}
            />
          </label>
          <label>
            Max per payment (sats, optional)
            <input
              inputMode="numeric"
              value={fmt(perAction)}
              onChange={(e) => setPerAction(digits(e.target.value))}
            />
          </label>
        </div>
        <label>
          Resets on day
          <select value={resetDay} onChange={(e) => setResetDay(Number(e.target.value))}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        {err ? <p className="err">{err}</p> : null}
        <button type="submit" className="cardbuilder__submit" disabled={busy || !scope.length}>
          {busy ? "Making…" : "Make this card"}
        </button>
        <p className="muted">
          A card is a policy on your own wallet, never a balance. Your usual daily and per-payment
          caps still apply first; a card never raises anything.
        </p>
      </div>
    </form>
  )
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      className="cardbuilder__copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setOk(true)
          setTimeout(() => setOk(false), 1500)
        } catch {
          /* clipboard blocked: the text is visible to copy by hand */
        }
      }}
    >
      {ok ? "Copied" : "Copy"}
    </button>
  )
}
