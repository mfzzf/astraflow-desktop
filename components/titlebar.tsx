"use client"

import * as React from "react"

import { SidebarToggleButton } from "@/components/sidebar-toggle-button"
import { cn } from "@/lib/utils"

type TitlebarSurfaceProps = React.ComponentProps<"div">

type TitlebarControlGroupProps = React.ComponentProps<"div"> & {
  align?: "leading" | "trailing"
  name: string
}

type TitlebarViewportControlProps = React.ComponentProps<"div">

type TitlebarProps = {
  children?: React.ReactNode
  trailing?: React.ReactNode
  showSidebarToggle?: boolean
  className?: string
}

/**
 * The single renderer-side titlebar coordinate system. Every titlebar surface
 * starts at y=0 of its containing window surface and every control group fills
 * exactly --titlebar-height, so align-items:center always resolves to the same
 * native center line.
 */
function TitlebarSurface({
  children,
  className,
  ...props
}: TitlebarSurfaceProps) {
  return (
    <div
      data-titlebar-surface
      className={cn(
        "relative isolate flex h-(--titlebar-height) w-full min-w-0 shrink-0 items-center",
        className
      )}
      {...props}
    >
      <div
        aria-hidden
        data-electron-drag-header
        data-titlebar-drag-region
        className="absolute inset-0 z-0"
      />
      <div
        data-titlebar-content
        className="relative z-10 flex h-full w-full min-w-0 items-center"
      >
        {children}
      </div>
    </div>
  )
}

function TitlebarControlGroup({
  align = "leading",
  className,
  name,
  ...props
}: TitlebarControlGroupProps) {
  return (
    <div
      data-titlebar-control-group={name}
      className={cn(
        "absolute top-0 flex h-(--titlebar-height) items-center",
        align === "leading"
          ? "left-(--titlebar-toggle-left) gap-2"
          : "right-1.5 gap-1",
        className
      )}
      {...props}
    />
  )
}

/** A viewport-level control anchored to the same row as every titlebar. */
function TitlebarViewportControl({
  className,
  ...props
}: TitlebarViewportControlProps) {
  return (
    <div
      data-titlebar-control-group="viewport"
      className={cn(
        "fixed top-0 flex h-(--titlebar-height) items-center",
        className
      )}
      {...props}
    />
  )
}

function Titlebar({
  children,
  trailing,
  showSidebarToggle = false,
  className,
}: TitlebarProps) {
  return (
    <TitlebarSurface className={className}>
      {showSidebarToggle || children ? (
        <TitlebarControlGroup name="leading">
          {showSidebarToggle ? (
            <div data-tour-id="studio-sidebar-toggle" className="shrink-0">
              <SidebarToggleButton />
            </div>
          ) : null}
          {children}
        </TitlebarControlGroup>
      ) : null}
      {trailing ? (
        <TitlebarControlGroup align="trailing" name="trailing">
          {trailing}
        </TitlebarControlGroup>
      ) : null}
    </TitlebarSurface>
  )
}

export {
  Titlebar,
  TitlebarControlGroup,
  TitlebarSurface,
  TitlebarViewportControl,
}
