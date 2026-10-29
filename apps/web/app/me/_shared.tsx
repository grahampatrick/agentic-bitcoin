import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { type Workspace, workspaceFor } from "@/lib/me/service"
import { getMeStores } from "@/lib/me/store"
import { chatLinks } from "@/lib/onboarding-links"
import Link from "next/link"
import "../page.css"
import "./me.css"

export const dynamic = "force-dynamic"

export async function loadWorkspace(
  searchParams: Promise<{ t?: string }>,
): Promise<Workspace | null> {
  const { t } = await searchParams
  return workspaceFor(t)
}

/** No link, a wrong one, or an expired one: how to get in, and the demo when there is no database. */
export function SignedOut() {
  const links = chatLinks()
  const demo = getMeStores().demo
  return (
    <>
      <SiteHeader />
      <main className="page me-out">
        <h1>Your workspace opens from chat.</h1>
        <p>
          There is no password. The assistant you already text is the key: it sends you a private
          link that works for thirty days from any browser.
        </p>
        <ol className="steps">
          <li>
            {links.signal ? (
              <>
                Text Agentic Bitcoin on <a href={links.signal.url}>Signal {links.signal.number}</a>.
              </>
            ) : (
              <>
                <Link href="/text">Text Agentic Bitcoin</Link>.
              </>
            )}
          </li>
          <li>
            Send <code>/web</code>. Open the link it replies with.
          </li>
          <li>
            Done with a browser? <code>/web revoke</code> cuts every link off.
          </li>
        </ol>
        <p className="small">
          A link you were using and that stopped working has expired or been revoked. Send{" "}
          <code>/web</code> again for a fresh one.
          {demo ? (
            <>
              {" "}
              This server has no database yet, so there is a{" "}
              <Link href="/me?t=demo">demo workspace</Link> with a fictional account.
            </>
          ) : null}
        </p>
        <LegalLinks />
      </main>
    </>
  )
}

export const sats = (s: string) => `${Number(s).toLocaleString("en-US")} sats` // money-ok: display of an integer string
