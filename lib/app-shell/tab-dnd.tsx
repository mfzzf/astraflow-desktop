"use client"

import * as React from "react"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverlayProps,
  DragOverlay,
  useDndContext,
} from "@dnd-kit/core"
import { useSortable } from "@dnd-kit/sortable"

import type { AppShellTabPlacement, AppShellTabController } from "./tab-controller"

type Kind = "app-shell-tab" | "app-shell-tab-strip"
type CollisionDetectionArgs = Parameters<CollisionDetection>[0]

type TabPayload = {
  kind: "app-shell-tab"
  controller: AppShellTabController
  tabId: string
}

type StripPayload = {
  kind: "app-shell-tab-strip"
  controller: AppShellTabController
}

export type AppShellTabDndPayload = TabPayload | StripPayload

function getData(value: unknown) {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function toTabPayload(value: unknown): TabPayload | null {
  const data = getData(value)

  if (data?.kind !== "app-shell-tab") {
    return null
  }

  const tabId = data.tabId
  const controller = data.controller

  if (typeof tabId !== "string" || typeof controller !== "object" || controller == null) {
    return null
  }

  return { kind: "app-shell-tab", tabId, controller: controller as AppShellTabController }
}

function toStripPayload(value: unknown): StripPayload | null {
  const data = getData(value)

  if (data?.kind !== "app-shell-tab-strip") {
    return null
  }

  const controller = data.controller

  if (typeof controller !== "object" || controller == null) {
    return null
  }

  return { kind: "app-shell-tab-strip", controller: controller as AppShellTabController }
}

export function getAppShellTabInsertionPlacement(
  x: number,
  left: number,
  width: number,
): AppShellTabPlacement {
  return x <= left + width / 2 ? "before" : "after"
}

function addPlacement(entry: Collision, args: CollisionDetectionArgs): Collision {
  const rect = args.droppableRects.get(entry.id)
  const pointer = args.pointerCoordinates

  if (rect == null || pointer == null) {
    return entry
  }

  return {
    ...entry,
    data: {
      ...(entry.data as Record<string, unknown>),
      appShellTabInsertionPlacement: getAppShellTabInsertionPlacement(
        pointer.x,
        rect.left,
        rect.width,
      ),
    },
  }
}

export function getTabInsertionPlacementFromEvent(
  event: DragEndEvent,
  fallback: AppShellTabPlacement = "before",
): AppShellTabPlacement {
  const placementCollision = event.collisions?.find(
    (collision) => collision.id === event.over?.id,
  )

  const payload = getData(placementCollision?.data)

  if (payload?.appShellTabInsertionPlacement === "after") {
    return "after"
  }

  if (payload?.appShellTabInsertionPlacement === "before") {
    return "before"
  }

  return fallback
}

function filterCollisionsByKind(
  args: CollisionDetectionArgs,
  kind: Kind,
): Collision[] {
  const entries = args.droppableContainers
    .filter((container) => getData(container.data.current)?.kind === kind)

  const collisions = closestCenter({
    ...args,
    droppableContainers: entries,
  })

  return collisions.map((entry) => addPlacement(entry, args))
}

export function tabCollisionDetection(args: CollisionDetectionArgs) {
  const tabCollisions = filterCollisionsByKind(args, "app-shell-tab")

  if (tabCollisions.length > 0) {
    return tabCollisions
  }

  const stripCollisions = filterCollisionsByKind(args, "app-shell-tab-strip")

  const overStrip = stripCollisions[0]
  if (overStrip == null) {
    return stripCollisions
  }

  const stripContainer = args.droppableContainers.find(
    (container) => container.id === overStrip.id,
  )
  const strip = getData(stripContainer?.data.current)
  const stripController = strip?.controller

  if (stripController == null) {
    return stripCollisions
  }

  const panelTabs = args.droppableContainers.filter((entry) => {
    const payload = toTabPayload(entry.data.current)
    return payload?.kind === "app-shell-tab" && payload.controller.panelId === (stripController as AppShellTabController).panelId
  })

  if (panelTabs.length === 0) {
    return stripCollisions
  }

  return closestCenter({
    ...args,
    droppableContainers: panelTabs,
  }).map((entry) => addPlacement(entry, args))
}

function useDndPayload<T>(id: string, data: T, disabled?: boolean) {
  return useDraggable({ id, data: data as Record<string, unknown>, disabled })
}

export function AppShellTabStripDraggable({
  id,
  data,
  disabled,
  children,
}: {
  id: string
  data: AppShellTabDndPayload
  disabled?: boolean
  children: (value: {
    isDragging: boolean
    setNodeRef: (node: HTMLElement | null) => void
    listeners: DraggableSyntheticListeners
    attributes: DraggableAttributes
  }) => React.ReactElement
}) {
  const draggable = useDndPayload(id, data, disabled)

  return children({
    isDragging: draggable.isDragging,
    setNodeRef: draggable.setNodeRef,
    listeners: draggable.listeners,
    attributes: draggable.attributes,
  })
}

export function AppShellSortableTab({
  id,
  data,
  disabled,
  children,
}: {
  id: string
  data: AppShellTabDndPayload
  disabled?: boolean
  children: (value: {
    isDragging: boolean
    setNodeRef: (node: HTMLElement | null) => void
    listeners: DraggableSyntheticListeners
    attributes: DraggableAttributes
    style: React.CSSProperties
  }) => React.ReactElement
}) {
  const sortable = useSortable({ id, data, disabled })

  const style: React.CSSProperties = {
    transform: sortable.transform
      ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
      : undefined,
    transition: sortable.transition,
  }

  return children({
    isDragging: sortable.isDragging,
    setNodeRef: sortable.setNodeRef,
    listeners: sortable.listeners,
    attributes: sortable.attributes,
    style,
  })
}

export function AppShellTabDragOverlay({
  children,
  className,
}: {
  children: (activeTabId: string | null) => React.ReactNode
  className?: string
}) {
  const { active } = useDndContext()
  const activeId = active ? String(active.id) : null

  return (
    <DragOverlay className={className}>
      {children(activeId)}
    </DragOverlay>
  )
}

export function AppShellTabDragDropContext({
  children,
  onDragStart,
  onDragEnd,
  collisionDetection = tabCollisionDetection,
}: {
  children: React.ReactNode
  onDragStart?: (event: DragStartEvent) => void
  onDragEnd?: (event: DragEndEvent) => void
  collisionDetection?: CollisionDetection
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {children}
    </DndContext>
  )
}

export type { CollisionDetection, DragStartEvent, DragEndEvent, DragOverlayProps }
export { DragOverlay as AppShellDragOverlay, closestCenter }
export { AppShellSortableTab as SortableTab }
export { AppShellTabStripDraggable as TabStripDraggable }
export {
  toTabPayload,
  toStripPayload,
}
