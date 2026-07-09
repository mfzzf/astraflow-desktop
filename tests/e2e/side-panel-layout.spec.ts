import { expect, test } from "@playwright/test"

import {
  getSidePanelWidthBounds,
  resolveSidePanelWidth,
} from "../../components/desktop-shell/side-panel"

test.describe("desktop side-panel width", () => {
  test("uses the actual main-content width and preserves the regular workspace", () => {
    expect(getSidePanelWidthBounds(1_020)).toEqual({
      minimum: 320,
      maximum: 660,
    })
    expect(resolveSidePanelWidth(480, 1_020)).toBe(480)

    expect(getSidePanelWidthBounds(740)).toEqual({
      minimum: 320,
      maximum: 380,
    })
    expect(resolveSidePanelWidth(480, 740)).toBe(380)
  })

  test("shrinks proportionally when the sidebar leaves a compact workspace", () => {
    const availableWidth = 520
    const panelWidth = resolveSidePanelWidth(480, availableWidth)

    expect(panelWidth).toBeCloseTo(239.2)
    expect(availableWidth - panelWidth).toBeGreaterThan(280)
  })

  test("never exceeds the real main-content width", () => {
    expect(resolveSidePanelWidth(960, 0)).toBe(0)
    expect(resolveSidePanelWidth(960, 180)).toBeLessThanOrEqual(180)
  })
})
