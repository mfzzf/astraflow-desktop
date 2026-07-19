export const palette = {
  ink: "#111C24",
  inkSoft: "#1A2A35",
  paper: "#F3F0E8",
  paperRaised: "#FFFCF5",
  paperMuted: "#E6E1D5",
  signal: "#D5FF5F",
  signalDark: "#698900",
  coral: "#FF7B64",
  sky: "#9ED8F6",
  white: "#FFFFFF",
  text: "#17232B",
  textMuted: "#667179",
  textOnDark: "#F8F6EF",
  border: "#D5D0C5",
  success: "#1D8C68",
  warning: "#B66A1E",
  danger: "#C4473A",
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 48,
} as const

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
} as const

export const font = {
  body: "IBMPlexSans_400Regular",
  medium: "IBMPlexSans_500Medium",
  semibold: "IBMPlexSans_600SemiBold",
  display: "Fraunces_600SemiBold",
  displayItalic: "Fraunces_600SemiBold_Italic",
} as const

export function statusColor(status?: string) {
  switch (status) {
    case "completed":
    case "ready":
    case "approved":
      return palette.success
    case "failed":
    case "denied":
    case "cancelled":
    case "unavailable":
      return palette.danger
    case "waiting_approval":
    case "waiting_input":
    case "waiting_device":
      return palette.warning
    default:
      return palette.signalDark
  }
}
