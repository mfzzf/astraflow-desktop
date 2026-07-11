"use client"

import * as React from "react"
import { atom, type Atom, type PrimitiveAtom, type WritableAtom } from "jotai"
import { atomFamily } from "jotai/vanilla/utils"

import {
  getRightPanelMinimumWidth,
  getRightPanelMaximumWidth,
  getRightPanelWidth,
  setRightPanelOpen,
  setBottomPanelOpen,
  rightPanelOpenAtom,
  bottomPanelOpenAtom,
} from "./store"
import type { AppShellStore as Store } from "./store"

export type AppShellTabKind = "regular" | "preview" | "label"
export type PanelId = "right" | "bottom"
export type AppShellTabPlacement = "before" | "after"

export type AppShellTabRecord = {
  tabId: string
  kind: AppShellTabKind | string
  title: React.ReactNode
  tooltip?: React.ReactNode
  icon?: React.ReactNode
  highlightedIcon?: React.ReactNode
  isClosable: boolean
  isPreview: boolean
  isPinned: boolean
  isLabel: boolean
  isHighlighted: boolean
  contextMenuItems?: Array<{
    id: string
    label: React.ReactNode
    onSelect: () => void
    disabled?: boolean
    destructive?: boolean
  }>
  trailingContent?: React.ReactNode
  props: Record<string, unknown>
  Component?: React.ComponentType<{
    tabId: string
    isActive: boolean
    isPreview: boolean
    tabState: unknown
    setTabState: (next: React.SetStateAction<unknown>) => void
    onClose: () => void
    onActivate?: () => void
  }>
  hasExternalFocus?: () => boolean
  dndId: string
  onActivate?: () => void
  onBeforeClose?: (store: Store) => boolean | void
  onClose?: () => void
  onMove?: (store: Store, panel: PanelId) => { props?: Record<string, unknown> } | void
  defaultState?: () => unknown
  resetState?: (value: unknown) => unknown
  requiresWorkspaceReady?: boolean
}

export type AppShellTabInput = {
  id?: string
  kind?: AppShellTabKind | string
  title: React.ReactNode
  tooltip?: React.ReactNode
  icon?: React.ReactNode
  highlightedIcon?: React.ReactNode
  isClosable?: boolean
  isPreview?: boolean
  isLabel?: boolean
  isHighlighted?: boolean
  contextMenuItems?: Array<{
    id: string
    label: React.ReactNode
    onSelect: () => void
    disabled?: boolean
    destructive?: boolean
  }>
  trailingContent?: React.ReactNode
  hasExternalFocus?: () => boolean
  insertAfterTabId?: string
  activate?: boolean
  Component?: React.ComponentType<{
    tabId: string
    isActive: boolean
    isPreview: boolean
    tabState: unknown
    setTabState: (next: React.SetStateAction<unknown>) => void
    onClose: () => void
    onActivate?: () => void
  }>
  props?: Record<string, unknown>
  onActivate?: () => void
  onBeforeClose?: (store: Store) => boolean | void
  onClose?: () => void
  onMove?: (store: Store, panel: PanelId) => { props?: Record<string, unknown> } | void
  defaultState?: () => unknown
  resetState?: (value: unknown) => unknown
  requiresWorkspaceReady?: boolean
}

type AppShellTabStateRecord = {
  key: number
  value: unknown
}

type TabPayload = {
  tab: AppShellTabRecord
  state: AppShellTabStateRecord | null
}

export type TabController = {
  openTab: (store: Store, input: AppShellTabInput) => string
  closeTab: (store: Store, tabId: string) => void
  closeActiveTab: (store: Store) => boolean
  closeOtherTabs: (store: Store, tabId: string) => void
  closeTabsToRight: (store: Store, tabId: string) => void
  activateTab: (store: Store, tabId: string | null) => void
  activateAdjacentTab: (store: Store, direction: "next" | "previous") => boolean
  moveTabTo: (
    store: Store,
    tabId: string,
    targetController: TabController,
    overTabId: string | null,
    options?: { activate?: boolean; insertionPlacement?: AppShellTabPlacement },
  ) => void
  receiveMovedTab: (
    store: Store,
    payload: TabPayload,
    overTabId: string | null,
    options?: { activate?: boolean; insertionPlacement?: AppShellTabPlacement },
  ) => void
  reorderTab: (
    store: Store,
    tabId: string,
    overTabId: string,
    options?: { insertion?: AppShellTabPlacement; activate?: boolean },
  ) => void
  updateTab: (store: Store, tabId: string, patch: Partial<AppShellTabInput>) => void
  pinTab: (store: Store, tabId: string) => void
  resetTabState: (store: Store, tabId: string) => void

  tabIdsAtom: PrimitiveAtom<string[]>
  tabByIdAtomFamily: ReturnType<
    typeof atomFamily<string, PrimitiveAtom<AppShellTabRecord | null>>
  >
  tabsAtom: Atom<AppShellTabRecord[]>
  activeTabAtom: PrimitiveAtom<string | null>
  activeTabReactKeyAtom: PrimitiveAtom<string>
  tabStateByIdAtomFamily: ReturnType<
    typeof atomFamily<string, WritableAtom<AppShellTabStateRecord | null, [AppShellTabStateRecord | null], void>>
  >
  panelId: PanelId
}

type TabControllerArgs = {
  panelId: PanelId
  panelOpenAtom: PrimitiveAtom<boolean>
  setPanelOpen: (store: Store, open: boolean) => void
}

const panelHistoryAtom = atom<string[]>([])
let tabDndIdSeq = 0

function createTabId() {
  tabDndIdSeq += 1
  return `app-shell-tab:${tabDndIdSeq}`
}

function clampIndex(index: number, length: number) {
  if (length <= 0) {
    return -1
  }

  return Math.max(0, Math.min(index, length - 1))
}

function getTabInsertIndex(
  tabIds: string[],
  overTabId: string | null,
  placement: AppShellTabPlacement,
) {
  if (overTabId == null) {
    return tabIds.length
  }

  const index = tabIds.indexOf(overTabId)

  if (index === -1) {
    return placement === "after" ? tabIds.length : 0
  }

  return placement === "before" ? index : index + 1
}

function findNextActive(
  remaining: string[],
  history: string[],
  fallbackClosedIndex: number,
) {
  const next = history.find((item) => remaining.includes(item))

  if (next != null) {
    return next
  }

  if (remaining.length === 0) {
    return null
  }

  const index = clampIndex(fallbackClosedIndex, remaining.length)
  return remaining[index] ?? remaining[Math.max(0, index - 1)] ?? remaining[0] ?? null
}

function scrollTabIntoView(panelId: PanelId, tabId: string) {
  const selector = `[data-app-shell-tab-controller="${panelId}"][data-tab-id="${CSS?.escape?.(tabId) ?? tabId}"]`

  document
    .querySelectorAll(selector)
    .forEach((node) => (node as HTMLElement | null)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }))
}

function focusTabPanel(panelId: PanelId, tabId: string) {
  const node = document.querySelector<HTMLElement>(
    `[role="tabpanel"][data-app-shell-tab-panel-controller="${panelId}"][data-tab-id="${tabId}"]`,
  )

  if (node != null && !node.contains(document.activeElement)) {
    node.focus({ preventScroll: true })
  }
}

function getDisplayStateStoreKey(mainContentWidth: number, fullWidthPanel: boolean) {
  return `${mainContentWidth}-${fullWidthPanel ? "full" : "regular"}` as const
}

function nearestDisplayState(mainContentWidth: number, fullWidthPanel: boolean, ratio: number) {
  const key = getDisplayStateStoreKey(mainContentWidth, fullWidthPanel)
  return {
    key,
    minimum: getRightPanelMinimumWidth(fullWidthPanel ? "full" : "regular", mainContentWidth),
    maximum: getRightPanelMaximumWidth(fullWidthPanel ? "full" : "regular", mainContentWidth),
    width: getRightPanelWidth(
      ratio,
      mainContentWidth,
      fullWidthPanel ? "full" : "regular",
    ),
  }
}

function createTabControllerState(panelId: PanelId, panelOpenAtom: PrimitiveAtom<boolean>) {
  const tabIdsAtom = atom<string[]>([])
  const tabByIdAtomFamily = atomFamily<string, PrimitiveAtom<AppShellTabRecord | null>>(
    () => atom<AppShellTabRecord | null>(null),
  )
  const tabsAtom = atom((get) =>
    get(tabIdsAtom).map((tabId) => get(tabByIdAtomFamily(tabId))).filter(
      (tab): tab is AppShellTabRecord => tab != null,
    ),
  )
  const activeTabAtom = atom<string | null>(null)
  const activeTabReactKeyAtom = atom(`${panelId}:none:0`)
  const tabStateByIdAtomFamily = atomFamily<
    string,
    WritableAtom<AppShellTabStateRecord | null, [AppShellTabStateRecord | null], void>
  >(() => atom<AppShellTabStateRecord | null>(null))

  return {
    panelId,
    panelOpenAtom,
    tabIdsAtom,
    tabByIdAtomFamily,
    tabsAtom,
    activeTabAtom,
    activeTabReactKeyAtom,
    tabStateByIdAtomFamily,
  }
}

function createRenderKey(tabId: string | null, state: AppShellTabStateRecord | null) {
  if (tabId == null) {
    return `${tabId}:none:0`
  }

  return `${tabId}:${state?.key ?? 0}`
}

function createRecord(input: AppShellTabInput, controllerId: PanelId, existingDndId?: string): AppShellTabRecord {
  const isLabel = input.isLabel === true
  const preview = input.isPreview === true

  return {
    tabId: "",
    kind: input.kind ?? (isLabel ? "label" : "regular"),
    title: input.title,
    tooltip: input.tooltip,
    icon: input.icon,
    highlightedIcon: input.highlightedIcon,
    isClosable: !isLabel && input.isClosable !== false,
    isPreview: preview,
    isPinned: isLabel || (!preview && !input.isPreview),
    isLabel,
    isHighlighted: input.isHighlighted ?? false,
    contextMenuItems: input.contextMenuItems,
    trailingContent: input.trailingContent,
    hasExternalFocus: input.hasExternalFocus,
    props: input.props ?? {},
    dndId: existingDndId ?? createTabId(),
    onActivate: input.onActivate,
    onBeforeClose: input.onBeforeClose,
    onClose: input.onClose,
    onMove: input.onMove,
    defaultState: input.defaultState,
    resetState: input.resetState,
    requiresWorkspaceReady: input.requiresWorkspaceReady,
    Component: input.Component,
  }
}

export function createTabPanelController({
  panelId,
  panelOpenAtom,
  setPanelOpen,
}: TabControllerArgs): TabController {
  const state = createTabControllerState(panelId, panelOpenAtom)
  const panelHistory = atom((get) => get(panelHistoryAtom))

  function setActiveTab(store: Store, tabId: string | null) {
    store.set(state.activeTabAtom, tabId)

    const stateValue = tabId == null ? null : store.get(state.tabStateByIdAtomFamily(tabId))
    store.set(state.activeTabReactKeyAtom, createRenderKey(tabId, stateValue))

    if (tabId == null) {
      return
    }

    const tab = store.get(state.tabByIdAtomFamily(tabId))
    if (tab?.onActivate) {
      tab.onActivate()
    }

    const nextHistory = store.get(panelHistory)
      .filter((value) => value !== tabId)

    store.set(panelHistoryAtom, [tabId, ...nextHistory])

    requestAnimationFrame(() => {
      scrollTabIntoView(panelId, tabId)
      focusTabPanel(panelId, tabId)
    })
  }

  function activateIfNeeded(store: Store, tabId: string | null) {
    if (tabId == null) {
      setActiveTab(store, null)
      return
    }

    if (store.get(state.activeTabAtom) === tabId) {
      return
    }

    setActiveTab(store, tabId)
  }

  function replaceExistingPreview(store: Store, previewTab: AppShellTabRecord) {
    const ids = store.get(state.tabIdsAtom)
    const existingPreview = ids.find((id) => {
      const tab = store.get(state.tabByIdAtomFamily(id))
      return tab?.isPreview
    })

    if (existingPreview == null || existingPreview === previewTab.tabId) {
      return
    }

    const removeId = store.get(state.tabByIdAtomFamily(existingPreview))
    if (removeId == null) {
      store.set(
        state.tabIdsAtom,
        (current) => current.filter((candidate) => candidate !== existingPreview),
      )
      return
    }

    store.set(state.tabIdsAtom, (current) => current.filter((candidate) => candidate !== existingPreview))
    store.set(state.tabByIdAtomFamily(existingPreview), null)
    store.set(state.tabStateByIdAtomFamily(existingPreview), null)
    store.set(panelHistoryAtom, (history) => history.filter((item) => item !== existingPreview))

    if (store.get(state.activeTabAtom) === existingPreview) {
      setActiveTab(store, null)
    }

    removeId.onClose?.()
  }

  function syncPanelOpenFromActive(store: Store) {
    const hasTabs = store.get(state.tabIdsAtom).length > 0
    setPanelOpen(store, hasTabs)
  }

  function openTab(store: Store, input: AppShellTabInput) {
    const panelOpen = store.get(state.panelOpenAtom)
    const open = input.activate !== false
    const id = input.id ?? createTabId()
    const existing = store.get(state.tabByIdAtomFamily(id))
    const baseRecord = createRecord(input, panelId, existing?.dndId)
    const record: AppShellTabRecord = {
      ...baseRecord,
      tabId: id,
      isPreview: input.isPreview === true,
    }

    if (existing != null) {
      const patched = {
        ...existing,
        ...record,
        props: {
          ...existing.props,
          ...record.props,
        },
      }

      if (existing.isPinned) {
        patched.isPinned = true
      }

      if (existing.isPreview && input.isPreview === false) {
        patched.isPreview = false
      }

      if (existing.isLabel && input.isLabel !== true) {
        patched.isPinned = existing.isPinned
      }

      store.set(state.tabByIdAtomFamily(id), patched)

      if (input.insertAfterTabId) {
        const insertAfterTabId = input.insertAfterTabId
        const currentIds = store.get(state.tabIdsAtom)
        const index = currentIds.indexOf(insertAfterTabId)

        if (index !== -1) {
          store.set(state.tabIdsAtom, (current) => {
            const withoutTarget = current.filter((item) => item !== id)
            const from = withoutTarget.indexOf(insertAfterTabId)
            if (from === -1) {
              return [...withoutTarget, id]
            }

            const next = [...withoutTarget]
            next.splice(from + 1, 0, id)
            return next
          })
        }
      }

      if (open) {
        activateIfNeeded(store, id)
        syncPanelOpenFromActive(store)
        if (!panelOpen) {
          setPanelOpen(store, true)
        }
      }

      return id
    }

    if (record.isPreview) {
      replaceExistingPreview(store, record)
    }

    store.set(state.tabIdsAtom, (current) => {
      const index =
        input.insertAfterTabId == null
          ? -1
          : current.indexOf(input.insertAfterTabId)

      if (index === -1) {
        return [...current, record.tabId]
      }

      const next = [...current]
      next.splice(index + 1, 0, record.tabId)
      return next
    })

    if (record.defaultState != null) {
      store.set(
        state.tabStateByIdAtomFamily(record.tabId),
        {
          key: 0,
          value: record.defaultState(),
        },
      )
    }

    store.set(state.tabByIdAtomFamily(record.tabId), record)

    if (open) {
      activateIfNeeded(store, record.tabId)
      setPanelOpen(store, true)
    }

    return record.tabId
  }

  function removeTab(store: Store, tabId: string, adjustHistory = true) {
    const tab = store.get(state.tabByIdAtomFamily(tabId))
    if (tab == null) {
      return
    }

    if (tab.onBeforeClose?.(store) === false) {
      return
    }

    const ids = store.get(state.tabIdsAtom)
    const closedIndex = ids.indexOf(tabId)
    const nextIds = ids.filter((id) => id !== tabId)

    store.set(state.tabIdsAtom, nextIds)
    store.set(state.tabByIdAtomFamily(tabId), null)
    store.set(state.tabStateByIdAtomFamily(tabId), null)
    tab.onClose?.()

    if (store.get(state.activeTabAtom) !== tabId) {
      syncPanelOpenFromActive(store)
      return
    }

    let nextActive: string | null = null
    if (adjustHistory) {
      const history = store.get(panelHistoryAtom)
      nextActive = findNextActive(nextIds, history, closedIndex)
    }

    if (nextActive == null) {
      nextActive = nextIds[clampIndex(closedIndex, nextIds.length)]
    }

    setActiveTab(store, nextActive)
    syncPanelOpenFromActive(store)
    if (nextActive == null && state.panelOpenAtom) {
      setPanelOpen(store, false)
    }
  }

  function closeTab(store: Store, tabId: string) {
    const current = store.get(state.tabByIdAtomFamily(tabId))

    if (current == null || !current.isClosable) {
      return
    }

    removeTab(store, tabId, true)
  }

  function closeActiveTab(store: Store) {
    const active = store.get(state.activeTabAtom)

    if (active == null) {
      return false
    }

    closeTab(store, active)

    return true
  }

  function closeOtherTabs(store: Store, tabId: string) {
    const ids = store.get(state.tabIdsAtom)

    ids.forEach((id) => {
      if (id === tabId) {
        return
      }

      const tab = store.get(state.tabByIdAtomFamily(id))
      if (tab?.isClosable) {
        removeTab(store, id, false)
      }
    })

    setActiveTab(store, tabId)
    syncPanelOpenFromActive(store)
  }

  function closeTabsToRight(store: Store, tabId: string) {
    const ids = store.get(state.tabIdsAtom)
    const index = ids.indexOf(tabId)

    if (index === -1) {
      return
    }

    const removing = ids.slice(index + 1)
    removing.forEach((id) => {
      const tab = store.get(state.tabByIdAtomFamily(id))
      if (tab?.isClosable) {
        removeTab(store, id, false)
      }
    })

    const active = store.get(state.activeTabAtom)
    if (active == null || ids.includes(active) && ids.indexOf(active) > index) {
      setActiveTab(store, tabId)
    }

    syncPanelOpenFromActive(store)
  }

  function activateAdjacentTab(store: Store, direction: "next" | "previous") {
    const ids = store.get(state.tabIdsAtom)
    const active = store.get(state.activeTabAtom)

    if (active == null || ids.length === 0) {
      return false
    }

    const index = ids.indexOf(active)
    if (index === -1) {
      return false
    }

    const target = direction === "next" ? ids[index + 1] : ids[index - 1]

    if (target == null) {
      return false
    }

    activateIfNeeded(store, target)
    return true
  }

  function moveWithinController(
    store: Store,
    sourceTabId: string,
    targetTabId: string,
    placement: AppShellTabPlacement,
  ) {
    const ids = store.get(state.tabIdsAtom)
    const from = ids.indexOf(sourceTabId)
    const toBase = ids.indexOf(targetTabId)

    if (from === -1 || toBase === -1 || from === toBase) {
      return
    }

    const next = [...ids]
    const [tab] = next.splice(from, 1)

    if (tab == null) {
      return
    }

    const targetIndex = placement === "after" ? toBase + 1 : toBase
    next.splice(Math.min(Math.max(0, targetIndex), next.length), 0, tab)
    store.set(state.tabIdsAtom, next)
  }

  function reorderTab(
    store: Store,
    tabId: string,
    overTabId: string,
    options: { insertion?: AppShellTabPlacement; activate?: boolean } = {},
  ) {
    const placement = options.insertion ?? "before"

    moveWithinController(store, tabId, overTabId, placement)
    if (options.activate !== false) {
      activateIfNeeded(store, tabId)
    }
  }

  function receiveMovedTab(
    store: Store,
    payload: TabPayload,
    overTabId: string | null,
    options: { activate?: boolean; insertionPlacement?: AppShellTabPlacement } = {},
  ) {
    const activate = options.activate ?? true
    const insertPlacement = options.insertionPlacement ?? "before"

    if (store.get(state.tabByIdAtomFamily(payload.tab.tabId)) != null) {
      return
    }

    const next = payload.tab
    if (next.isPreview) {
      replaceExistingPreview(store, next)
    }

    if (next.isLabel && next.isPinned === false) {
      next.isPinned = true
    }

    const normalized = payload.state == null && next.defaultState != null
      ? {
          ...next,
          isPinned: next.isPinned || next.isLabel,
        }
      : next

    store.set(state.tabByIdAtomFamily(normalized.tabId), normalized)

    if (payload.state != null) {
      store.set(state.tabStateByIdAtomFamily(normalized.tabId), payload.state)
    } else if (normalized.defaultState != null) {
      store.set(state.tabStateByIdAtomFamily(normalized.tabId), {
        key: 0,
        value: normalized.defaultState(),
      })
    }

    const current = store.get(state.tabIdsAtom)
    const index = getTabInsertIndex(current, overTabId, insertPlacement)
    const nextIds = [...current]
    const insertAt = Math.min(Math.max(index, 0), nextIds.length)
    nextIds.splice(insertAt, 0, normalized.tabId)
    store.set(state.tabIdsAtom, nextIds)

    if (activate) {
      setActiveTab(store, normalized.tabId)
      setPanelOpen(store, true)
    }

    syncPanelOpenFromActive(store)
  }

  function moveTabTo(
    store: Store,
    tabId: string,
    targetController: TabController,
    overTabId: string | null,
    options: { activate?: boolean; insertionPlacement?: AppShellTabPlacement } = {},
  ) {
    if (targetController.panelId === panelId) {
      const ids = store.get(state.tabIdsAtom)
      const over = overTabId ?? ids[ids.length - 1]
      if (over == null || over === tabId) {
        return
      }

      reorderTab(store, tabId, over, {
        insertion: options.insertionPlacement,
        activate: options.activate,
      })
      return
    }

    const tab = store.get(state.tabByIdAtomFamily(tabId))
    if (tab == null) {
      return
    }

    const stateSnapshot = store.get(state.tabStateByIdAtomFamily(tabId))

    store.set(state.tabIdsAtom, (current) => current.filter((id) => id !== tabId))
    store.set(state.tabByIdAtomFamily(tabId), null)
    store.set(state.tabStateByIdAtomFamily(tabId), null)

    if (tab.onMove) {
      const result = tab.onMove(store, targetController.panelId)
      if (result?.props) {
        tab.props = {
          ...tab.props,
          ...result.props,
        }
      }
    }

    tab.onClose?.()

    if (store.get(state.activeTabAtom) === tabId) {
      setActiveTab(store, null)
    }

    const nextHistory = store.get(panelHistoryAtom).filter((id) => id !== tabId)
    store.set(panelHistoryAtom, nextHistory)

    syncPanelOpenFromActive(store)

    targetController.receiveMovedTab(store, { tab, state: stateSnapshot }, overTabId, {
      activate: options.activate,
      insertionPlacement: options.insertionPlacement ?? "before",
    })
  }

  function updateTab(store: Store, tabId: string, patch: Partial<AppShellTabInput>) {
    const current = store.get(state.tabByIdAtomFamily(tabId))

    if (current == null) {
      return
    }

    // Partial patches routinely carry explicit `undefined` values (callers
    // build the patch object with every key); those must not erase the
    // stored fields.
    const cleaned = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    )

    store.set(state.tabByIdAtomFamily(tabId), {
      ...current,
      ...cleaned,
      props: {
        ...current.props,
        ...(patch.props ?? {}),
      },
    })
  }

  function pinTab(store: Store, tabId: string) {
    const current = store.get(state.tabByIdAtomFamily(tabId))

    if (current == null || !current.isPreview) {
      return
    }

    store.set(state.tabByIdAtomFamily(tabId), {
      ...current,
      isPreview: false,
      isPinned: true,
    })

    if (store.get(state.tabStateByIdAtomFamily(tabId)) == null) {
      store.set(state.tabStateByIdAtomFamily(tabId), {
        key: 0,
        value: current.defaultState?.() ?? null,
      })
    }
  }

  function resetTabState(store: Store, tabId: string) {
    const currentTab = store.get(state.tabByIdAtomFamily(tabId))
    const currentState = store.get(state.tabStateByIdAtomFamily(tabId))

    if (currentTab == null) {
      return
    }

    const next = {
      key: (currentState?.key ?? 0) + 1,
      value: currentTab.resetState
        ? currentTab.resetState(currentState?.value)
        : currentTab.defaultState?.() ?? null,
    }

    store.set(state.tabStateByIdAtomFamily(tabId), next)
    if (store.get(state.activeTabAtom) === tabId) {
      store.set(state.activeTabReactKeyAtom, createRenderKey(tabId, next))
    }
  }

  return {
    panelId,
    tabIdsAtom: state.tabIdsAtom,
    tabByIdAtomFamily: state.tabByIdAtomFamily,
    tabsAtom: state.tabsAtom,
    activeTabAtom: state.activeTabAtom,
    activeTabReactKeyAtom: state.activeTabReactKeyAtom,
    tabStateByIdAtomFamily: state.tabStateByIdAtomFamily,
    openTab,
    closeTab,
    closeActiveTab,
    closeOtherTabs,
    closeTabsToRight,
    activateTab: setActiveTab,
    activateAdjacentTab,
    moveTabTo,
    reorderTab,
    receiveMovedTab,
    updateTab,
    pinTab,
    resetTabState,
  }
}

export function createRightPanelController(): TabController {
  return createTabPanelController({
    panelId: "right",
    panelOpenAtom: rightPanelOpenAtom,
    setPanelOpen: setRightPanelOpen,
  })
}

export function createBottomPanelController(): TabController {
  return createTabPanelController({
    panelId: "bottom",
    panelOpenAtom: bottomPanelOpenAtom,
    setPanelOpen: setBottomPanelOpen,
  })
}

export { nearestDisplayState, getDisplayStateStoreKey }
export type { TabController as AppShellTabController }
