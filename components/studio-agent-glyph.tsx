import { cn } from "@/lib/utils"

export type StudioAgentGlyphStatus =
  "running" | "complete" | "error" | "cancelled"

type StudioAgentGlyphProps = {
  identity: string
  status: StudioAgentGlyphStatus
  className?: string
}

const palettes = [
  { name: "blue", light: "#73b7ff", dark: "#4f8fe9" },
  { name: "orange", light: "#ffc176", dark: "#ff9d45" },
  { name: "green", light: "#b5e999", dark: "#74c96a" },
  { name: "mint", light: "#7de3c6", dark: "#45c7a7" },
  { name: "violet", light: "#bbb2e9", dark: "#8f83cc" },
] as const

const petalAngles = [0, 60, 120, 180, 240, 300] as const

function getIdentityHash(identity: string) {
  let hash = 2_166_136_261

  for (const character of identity.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }

  return hash >>> 0
}

function getIdentityPalette(identity: string) {
  return palettes[getIdentityHash(identity) % palettes.length]
}

export function StudioAgentGlyph({
  identity,
  status,
  className,
}: StudioAgentGlyphProps) {
  const palette = getIdentityPalette(identity)
  const isRunning = status === "running"
  const isDesaturated = status === "error" || status === "cancelled"

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "studio-agent-glyph size-5 shrink-0 overflow-visible",
        `studio-agent-glyph--${status}`,
        isRunning && "studio-agent-glyph-orbit",
        isDesaturated &&
          "studio-agent-glyph-desaturated opacity-70 grayscale saturate-50",
        className
      )}
      data-agent-hue={palette.name}
      data-agent-status={status}
      focusable="false"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        className={cn(
          "studio-agent-glyph-petals",
          isRunning && "studio-agent-glyph-breathe"
        )}
      >
        {petalAngles.map((angle, index) => (
          <rect
            fill={index % 2 === 0 ? palette.light : palette.dark}
            height="9.2"
            key={angle}
            opacity={index % 2 === 0 ? "0.95" : "0.82"}
            rx="1.85"
            transform={`rotate(${angle} 10 10)`}
            width="3.7"
            x="8.15"
            y="1.15"
          />
        ))}
      </g>
      <circle
        className="studio-agent-glyph-core"
        cx="10"
        cy="10"
        fill="white"
        fillOpacity="0.78"
        r="2.1"
      />
    </svg>
  )
}
