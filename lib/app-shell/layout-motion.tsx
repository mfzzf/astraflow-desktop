"use client"

import * as React from "react"
import { animate, motion, useMotionTemplate, useMotionValue, useTransform, useReducedMotion } from "motion/react"
import { useAtomValue } from "jotai"

import {
  appShellStore,
  focusAreaAtom,
  floatingSidebarVisibleAtom,
  getRightPanelWidthToPixels,
  rightPanelOpenAtom,
  rightPanelWidthRatioAtom,
  fullWidthPanelAtom,
  sidebarAnimationAtom,
  sidebarOpenAtom,
  sidebarWidthAtom,
  bottomPanelHeightRatioAtom,
} from "./store"

export const SHELL_SPRING = {
  type: "spring" as const,
  duration: 0.5,
  bounce: 0.1,
}

export type AppShellLayoutMotionContextValue = {
  shellWidth: ReturnType<typeof useMotionValue<number>>
  shellHeight: ReturnType<typeof useMotionValue<number>>
  mainContentWidth: ReturnType<typeof useMotionValue<number>>
  mainContentTargetWidth: ReturnType<typeof useMotionValue<number>>
  leftPanelWidth: ReturnType<typeof useMotionValue<number>>
  leftPanelAnimatedWidth: ReturnType<typeof useMotionValue<number>>
  rightPanelAnimatedWidth: ReturnType<typeof useMotionValue<number>>
  headerLeftWidth: ReturnType<typeof useMotionValue<number>>
  headerRightWidth: ReturnType<typeof useMotionValue<number>>
  rightPanelLayoutTick: ReturnType<typeof useMotionValue<number>>
  isMounted: boolean
}

const AppShellLayoutMotionContext = React.createContext<
  AppShellLayoutMotionContextValue | null
>(null)

function useWindowDimensionMotion(axis: "width" | "height") {
  const value = useMotionValue(0)

  React.useLayoutEffect(() => {
    const update = () => {
      if (axis === "width") {
        value.set(window.innerWidth)
      } else {
        value.set(window.innerHeight)
      }
    }

    update()
    window.addEventListener("resize", update)

    return () => {
      window.removeEventListener("resize", update)
    }
  }, [axis, value])

  return value
}

export function useAppShellLayoutMotion() {
  const context = React.useContext(AppShellLayoutMotionContext)

  if (context == null) {
    throw new Error("AppShell layout motion context is missing")
  }

  return context
}

function useSidebarWidthFromAtom(
  sidebarWidth: number,
  sidebarOpen: boolean,
  sidebarAnimated: boolean,
) {
  const widthPixel = useMotionValue(sidebarWidth)
  const animatedWidth = useMotionValue(sidebarOpen ? sidebarWidth : 0)
  const reduceMotion = useReducedMotion()
  const [isMounted, setIsMounted] = React.useState(sidebarOpen)

  React.useEffect(() => {
    const target = sidebarOpen ? widthPixel.get() : 0
    if (!sidebarAnimated || reduceMotion) {
      animatedWidth.set(target)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsMounted(sidebarOpen)
      return
    }

    setIsMounted(true)
    const animation = animate(animatedWidth, target, {
      ...SHELL_SPRING,
      onComplete: () => {
        setIsMounted(sidebarOpen)
      },
    })

    return () => {
      animation.stop()
    }
  }, [animatedWidth, widthPixel, sidebarAnimated, sidebarOpen, reduceMotion])

  React.useEffect(() => {
    widthPixel.set(sidebarWidth)
    if (sidebarOpen) {
      animatedWidth.set(sidebarWidth)
    }
  }, [animatedWidth, sidebarOpen, sidebarWidth, widthPixel])

  return { widthPixel, animatedWidth, isMounted }
}

function useTickWhileVisible(isActive: boolean) {
  const tick = useMotionValue(0)

  React.useEffect(() => {
    if (!isActive) {
      return
    }

    let raf = 0

    const loop = () => {
      tick.set(tick.get() + 1)
      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
    }
  }, [isActive, tick])

  return tick
}

export function AppShellLayoutMotionProvider({
  children,
  className,
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  const reduceMotion = useReducedMotion()

  const shellWidth = useWindowDimensionMotion("width")
  const shellHeight = useWindowDimensionMotion("height")

  const sidebarOpen = useAtomValue(sidebarOpenAtom, { store: appShellStore })
  const sidebarAnimationEnabled = useAtomValue(sidebarAnimationAtom, {
    store: appShellStore,
  })
  const sidebarWidth = useAtomValue(sidebarWidthAtom, { store: appShellStore })
  const rightPanelOpen = useAtomValue(rightPanelOpenAtom, { store: appShellStore })
  const rightPanelRatio = useAtomValue(rightPanelWidthRatioAtom, {
    store: appShellStore,
  })
  const bottomPanelRatio = useAtomValue(bottomPanelHeightRatioAtom, {
    store: appShellStore,
  })
  const fullWidthPanel = useAtomValue(fullWidthPanelAtom, { store: appShellStore })
  const focusArea = useAtomValue(focusAreaAtom, { store: appShellStore })
  const floatingSidebarVisible = useAtomValue(floatingSidebarVisibleAtom, {
    store: appShellStore,
  })

  const {
    widthPixel: leftPanelWidth,
    animatedWidth: leftPanelAnimatedWidth,
    isMounted: isLeftPanelMounted,
  } = useSidebarWidthFromAtom(sidebarWidth, sidebarOpen, sidebarAnimationEnabled)

  const rightPanelRatioValue = useMotionValue(rightPanelRatio)
  const rightPanelOpenProgress = useMotionValue(rightPanelOpen ? 1 : 0)

  React.useEffect(() => {
    rightPanelRatioValue.set(rightPanelRatio)
  }, [rightPanelRatio, rightPanelRatioValue])

  React.useEffect(() => {
    if (reduceMotion) {
      rightPanelOpenProgress.set(rightPanelOpen ? 1 : 0)
      return
    }

    const animation = animate(rightPanelOpenProgress, rightPanelOpen ? 1 : 0, SHELL_SPRING)
    return () => {
      animation.stop()
    }
  }, [rightPanelOpen, rightPanelOpenProgress, reduceMotion])

  const mainContentWidth = useTransform(
    [shellWidth, leftPanelAnimatedWidth],
    ([availableWidth, panelWidth]: number[]) => Math.max(0, availableWidth - panelWidth),
  )

  const mainContentTargetWidth = useTransform(
    [shellWidth, leftPanelAnimatedWidth, rightPanelRatioValue],
    ([availableWidth, panelWidth, ratio]: number[]) => {
      const main = Math.max(0, availableWidth - panelWidth)
      const targetRight = getRightPanelWidthToPixels(ratio, main, fullWidthPanel)
      return rightPanelOpen ? Math.max(0, main - targetRight) : main
    },
  )

  const rightPanelAnimatedWidth = useTransform(
    [mainContentWidth, rightPanelRatioValue],
    ([availableWidth, ratio]: number[]) =>
      getRightPanelWidthToPixels(ratio, availableWidth, fullWidthPanel),
  )

  const rightPanelFinalWidth = useTransform(
    [rightPanelAnimatedWidth, rightPanelOpenProgress],
    ([width, open]: number[]) =>
      width * open,
  )

  const bottomPanelHeight = useTransform(shellHeight, (value) => Math.max(0, value * bottomPanelRatio))
  const bottomPanelHeightStyle = useMotionTemplate`${bottomPanelHeight}px`
  const rightPanelWidthStyle = useMotionTemplate`${rightPanelFinalWidth}px`
  const leftPanelWidthStyle = useMotionTemplate`${leftPanelAnimatedWidth}px`

  const headerLeftWidth = useMotionValue(0)
  const headerRightWidth = useMotionValue(0)
  const rightPanelLayoutTick = useTickWhileVisible(rightPanelOpen)

  const contentStyles = React.useMemo(
    () => ({
      "--app-shell-bottom-panel-height": bottomPanelHeightStyle,
      "--app-shell-right-panel-width": rightPanelWidthStyle,
      "--app-shell-left-panel-width": leftPanelWidthStyle,
    }),
    [bottomPanelHeightStyle, leftPanelWidthStyle, rightPanelWidthStyle],
  )

  const context = React.useMemo(
    () => ({
      shellWidth,
      shellHeight,
      mainContentWidth,
      mainContentTargetWidth,
      leftPanelWidth,
      leftPanelAnimatedWidth,
      rightPanelAnimatedWidth: rightPanelFinalWidth,
      headerLeftWidth,
      headerRightWidth,
      rightPanelLayoutTick,
      isMounted: isLeftPanelMounted,
    }),
    [
      shellHeight,
      shellWidth,
      mainContentTargetWidth,
      mainContentWidth,
      leftPanelAnimatedWidth,
      leftPanelWidth,
      rightPanelFinalWidth,
      headerLeftWidth,
      headerRightWidth,
      rightPanelLayoutTick,
      isLeftPanelMounted,
    ],
  )

  const inlineStyle = React.useMemo(
    () =>
      ({
        ...style,
        ...contentStyles,
      }) as React.CSSProperties,
    [contentStyles, style],
  )

  return (
    <AppShellLayoutMotionContext.Provider value={context}>
      <motion.div
        className={className}
        style={inlineStyle}
        data-app-shell-focus-area={focusArea}
        data-app-shell-open={isLeftPanelMounted ? "true" : "false"}
        data-app-shell-floating={floatingSidebarVisible ? "true" : "false"}
      >
        {children}
      </motion.div>
    </AppShellLayoutMotionContext.Provider>
  )
}

export { AppShellLayoutMotionContext }
