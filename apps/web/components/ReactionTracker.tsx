"use client"

import { useEffect } from "react"

/**
 * Pins each task's reaction bubble to the cursor (instinct.com pattern). Renders nothing; it
 * attaches one pointermove listener to the examples paragraph and writes --reaction-x/y on the
 * hovered task's anchor, relative to the paragraph (which is `position: relative`).
 * Pure CSS handles the pop; without JS the bubble simply appears at the phrase start.
 */
export function ReactionTracker() {
  useEffect(() => {
    const para = document.querySelector<HTMLElement>(".home__examples")
    if (!para) return
    const onMove = (e: PointerEvent) => {
      const task = (e.target as HTMLElement | null)?.closest<HTMLElement>(".home__task")
      if (!task) return
      const anchor = task.querySelector<HTMLElement>(".reaction-anchor")
      if (!anchor) return
      const box = para.getBoundingClientRect()
      anchor.style.setProperty("--reaction-x", `${Math.round(e.clientX - box.left)}px`)
      anchor.style.setProperty("--reaction-y", `${Math.round(e.clientY - box.top)}px`)
    }
    para.addEventListener("pointermove", onMove, { passive: true })
    return () => para.removeEventListener("pointermove", onMove)
  }, [])
  return null
}
