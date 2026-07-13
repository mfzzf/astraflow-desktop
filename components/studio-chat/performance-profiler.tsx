"use client"

import * as React from "react"

export type StudioProfilerSample = {
  id: string
  phase: "mount" | "update" | "nested-update"
  actualDuration: number
  baseDuration: number
  startTime: number
  commitTime: number
}

declare global {
  interface Window {
    __ASTRAFLOW_REACT_PROFILER_ENABLED__?: boolean
    __ASTRAFLOW_REACT_PROFILER_SAMPLES__?: StudioProfilerSample[]
  }
}

const MAX_PROFILE_SAMPLES = 10_000

function recordProfileSample(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number
) {
  if (
    process.env.NODE_ENV === "production" ||
    typeof window === "undefined" ||
    window.__ASTRAFLOW_REACT_PROFILER_ENABLED__ !== true
  ) {
    return
  }

  const samples = (window.__ASTRAFLOW_REACT_PROFILER_SAMPLES__ ??= [])

  samples.push({
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  })

  if (samples.length > MAX_PROFILE_SAMPLES) {
    samples.splice(0, samples.length - MAX_PROFILE_SAMPLES)
  }
}

export function StudioPerformanceProfiler({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  if (process.env.NODE_ENV === "production") {
    return children
  }

  return (
    <React.Profiler id={id} onRender={recordProfileSample}>
      {children}
    </React.Profiler>
  )
}
