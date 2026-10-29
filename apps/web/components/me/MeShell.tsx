import type { Workspace } from "@/lib/me/service"
import Image from "next/image"
import Link from "next/link"

export const NAV = [
  { key: "", label: "Workspace" },
  { key: "vault", label: "Vault" },
  { key: "people", label: "Trusted people" },
  { key: "preferences", label: "Preferences" },
  { key: "connectors", label: "Connectors" },
  { key: "invite", label: "Invite a friend" },
] as const

export function meHref(token: string, key = "") {
  return `/me${key ? `/${key}` : ""}?t=${encodeURIComponent(token)}`
}

/** The workspace frame: a quiet left column of links, the page on the right (M23). */
export function MeShell({
  w,
  active,
  children,
}: { w: Workspace; active: string; children: React.ReactNode }) {
  return (
    <div className="me">
      <aside className="me__side">
        <Link href="/" className="me__brand" aria-label="Anvard home">
          <Image src="/castle.png" alt="" width={167} height={151} unoptimized />
        </Link>
        <nav className="me__nav" aria-label="Workspace">
          {NAV.map((n) => (
            <Link
              key={n.key}
              href={meHref(w.token, n.key)}
              className={active === n.key ? "is-on" : ""}
              aria-current={active === n.key ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
          <Link href={meHref(w.token, "logout")}>Log out</Link>
        </nav>
        <p className="me__who">
          <span>{w.identity.surface}</span>
          <span>{w.identity.masked}</span>
        </p>
      </aside>
      <main className="me__main">
        {w.demo ? (
          <p className="me__demo">
            Demo workspace: a fictional account, so you can see the shape. Yours opens from chat
            with <code>/web</code>.
          </p>
        ) : null}
        {children}
      </main>
    </div>
  )
}

export function Section({
  title,
  sub,
  action,
  children,
}: { title: string; sub?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="me__section">
      <header className="me__head">
        <div>
          <h2>{title}</h2>
          {sub ? <p className="me__sub">{sub}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export function Row({
  title,
  sub,
  action,
  icon,
}: { title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; icon?: string }) {
  return (
    <div className="me__row">
      {icon ? (
        <span className="me__row-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="me__row-text">
        <p className="me__row-title">{title}</p>
        {sub ? <p className="me__row-sub">{sub}</p> : null}
      </div>
      {action ? <div className="me__row-action">{action}</div> : null}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="me__empty">{children}</p>
}
