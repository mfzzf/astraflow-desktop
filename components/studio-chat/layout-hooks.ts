"use client"

import * as React from "react"

import type { ComposerPopupPlacement } from "./types"

export function useElementWidth<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null)
  const [width, setWidth] = React.useState(0)

  React.useLayoutEffect(() => {
    const element = ref.current

    if (!element) {
      return
    }
    const currentElement = element

    function updateWidth() {
      setWidth(Math.round(currentElement.getBoundingClientRect().width))
    }

    updateWidth()

    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(currentElement)

    return () => resizeObserver.disconnect()
  }, [])

  return [ref, width] as const
}

export function useComposerPopupPlacement(
  anchorRef: React.RefObject<HTMLElement | null>,
  open: boolean
) {
  const [placement, setPlacement] =
    React.useState<ComposerPopupPlacement>("bottom")

  React.useLayoutEffect(() => {
    if (!open) {
      return
    }

    function updatePlacement() {
      const anchor = anchorRef.current

      if (!anchor) {
        setPlacement("bottom")
        return
      }

      const rect = anchor.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top

      setPlacement(
        spaceBelow < 320 && spaceAbove > spaceBelow ? "top" : "bottom"
      )
    }

    updatePlacement()
    window.addEventListener("resize", updatePlacement)

    return () => window.removeEventListener("resize", updatePlacement)
  }, [anchorRef, open])

  return placement
}
