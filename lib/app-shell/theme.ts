"use client"

import * as React from "react"

import { useTheme } from "@/components/theme-provider"

type ThemeVariant = "light" | "dark"

type Rgb = {
  red: number
  green: number
  blue: number
}

type BaseTheme = {
  accent: string
  contrast: number
  fonts: { code: string | null; ui: string | null }
  ink: string
  opaqueWindows: boolean
  semanticColors: { diffAdded: string; diffRemoved: string; skill: string }
  surface: string
}

type StoredShellTheme = {
  codeThemeId?: string
  theme: BaseTheme
  variant: ThemeVariant
}

type ShellThemeContextValue = StoredShellTheme & {
  baseTheme: BaseTheme
  setBaseTheme: (theme: BaseTheme | ((current: BaseTheme) => BaseTheme)) => void
}

type DerivedTheme = {
  accent: Rgb
  contrast: number
  editorBackground: Rgb
  ink: Rgb
  surface: Rgb
  surfaceUnder: string
  theme: BaseTheme
  variant: ThemeVariant
}

type ThemePalette = {
  accentBackground: string
  accentBackgroundActive: string
  accentBackgroundHover: string
  border: string
  borderFocus: string
  borderHeavy: string
  borderLight: string
  buttonPrimaryBackground: string
  buttonPrimaryBackgroundActive: string
  buttonPrimaryBackgroundHover: string
  buttonPrimaryBackgroundInactive: string
  buttonSecondaryBackground: string
  buttonSecondaryBackgroundActive: string
  buttonSecondaryBackgroundHover: string
  buttonSecondaryBackgroundInactive: string
  buttonTertiaryBackground: string
  buttonTertiaryBackgroundActive: string
  buttonTertiaryBackgroundHover: string
  controlBackground: string
  controlBackgroundOpaque: string
  elevatedPrimary: string
  elevatedPrimaryOpaque: string
  elevatedSecondary: string
  elevatedSecondaryOpaque: string
  iconAccent: string
  iconPrimary: string
  iconSecondary: string
  iconTertiary: string
  simpleScrim: string
  textAccent: string
  textButtonPrimary: string
  textButtonSecondary: string
  textButtonTertiary: string
  textForeground: string
  textForegroundSecondary: string
  textForegroundTertiary: string
}

type CssVariables = Record<string, string>

const STORAGE_KEY = "app-shell:theme:v1"
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const BLACK: Rgb = { red: 0, green: 0, blue: 0 }
const WHITE: Rgb = { red: 255, green: 255, blue: 255 }

const DEFAULT_BASE_THEMES: Record<ThemeVariant, BaseTheme> = {
  light: {
    accent: "#339cff",
    contrast: 45,
    fonts: { code: null, ui: null },
    ink: "#1a1c1f",
    opaqueWindows: false,
    semanticColors: {
      diffAdded: "#00a240",
      diffRemoved: "#ba2623",
      skill: "#924ff7",
    },
    surface: "#ffffff",
  },
  dark: {
    accent: "#339cff",
    contrast: 60,
    fonts: { code: null, ui: null },
    ink: "#ffffff",
    opaqueWindows: false,
    semanticColors: {
      diffAdded: "#40c977",
      diffRemoved: "#fa423e",
      skill: "#ad7bf9",
    },
    surface: "#181818",
  },
}

const DEFAULT_CONTRAST: Record<ThemeVariant, number> = {
  light: DEFAULT_BASE_THEMES.light.contrast,
  dark: DEFAULT_BASE_THEMES.dark.contrast,
}

const SURFACE_UNDER_OFFSET: Record<ThemeVariant, number> = {
  light: 0.04,
  dark: 0.16,
}

const SURFACE_UNDER_CONTRAST_FACTOR: Record<ThemeVariant, number> = {
  light: 0.0012,
  dark: 0.0015,
}

const PANEL_OFFSET: Record<ThemeVariant, number> = {
  light: 0.18,
  dark: 0.03,
}

const PANEL_CONTRAST_FACTOR: Record<ThemeVariant, number> = {
  light: 0.008,
  dark: 0.03,
}

const ShellThemeContext = React.createContext<ShellThemeContextValue | null>(
  null
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function cloneBaseTheme(theme: BaseTheme): BaseTheme {
  return {
    accent: theme.accent,
    contrast: theme.contrast,
    fonts: { code: theme.fonts.code, ui: theme.fonts.ui },
    ink: theme.ink,
    opaqueWindows: theme.opaqueWindows,
    semanticColors: {
      diffAdded: theme.semanticColors.diffAdded,
      diffRemoved: theme.semanticColors.diffRemoved,
      skill: theme.semanticColors.skill,
    },
    surface: theme.surface,
  }
}

function getDefaultBaseTheme(variant: ThemeVariant) {
  return cloneBaseTheme(DEFAULT_BASE_THEMES[variant])
}

function normalizeHex(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback
  }

  const trimmed = value.trim()

  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : fallback
}

function normalizeStoredContrast(value: unknown, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback
  }

  return clamp(Math.round(value), 0, 100)
}

function normalizeFont(value: unknown, fallback: string | null) {
  if (typeof value !== "string") {
    return fallback
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeFonts(value: unknown, fallback: BaseTheme["fonts"]) {
  const record = isRecord(value) ? value : {}

  return {
    code: normalizeFont(record.code, fallback.code),
    ui: normalizeFont(record.ui, fallback.ui),
  }
}

function normalizeSemanticColors(
  value: unknown,
  fallback: BaseTheme["semanticColors"]
) {
  const record = isRecord(value) ? value : {}

  return {
    diffAdded: normalizeHex(record.diffAdded, fallback.diffAdded),
    diffRemoved: normalizeHex(record.diffRemoved, fallback.diffRemoved),
    skill: normalizeHex(record.skill, fallback.skill),
  }
}

function normalizeBaseTheme(value: unknown, fallback: BaseTheme): BaseTheme {
  const record = isRecord(value) ? value : {}

  return {
    accent: normalizeHex(record.accent, fallback.accent),
    contrast: normalizeStoredContrast(record.contrast, fallback.contrast),
    fonts: normalizeFonts(record.fonts, fallback.fonts),
    ink: normalizeHex(record.ink, fallback.ink),
    opaqueWindows:
      typeof record.opaqueWindows === "boolean"
        ? record.opaqueWindows
        : fallback.opaqueWindows,
    semanticColors: normalizeSemanticColors(
      record.semanticColors,
      fallback.semanticColors
    ),
    surface: normalizeHex(record.surface, fallback.surface),
  }
}

function isThemeVariant(value: unknown): value is ThemeVariant {
  return value === "light" || value === "dark"
}

function readResolvedVariant() {
  if (typeof window === "undefined") {
    return "light"
  }

  try {
    const storedTheme = window.localStorage.getItem("theme")

    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme
    }

    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark"
    }
  } catch {
    if (document.documentElement.classList.contains("dark")) {
      return "dark"
    }
  }

  return "light"
}

function normalizeStoredTheme(value: unknown, fallbackVariant: ThemeVariant) {
  const record = isRecord(value) ? value : {}
  const storedVariant = isThemeVariant(record.variant)
    ? record.variant
    : fallbackVariant
  const variant =
    storedVariant === fallbackVariant ? storedVariant : fallbackVariant
  const fallback = getDefaultBaseTheme(variant)
  const codeThemeId = normalizeOptionalString(record.codeThemeId)
  const state: StoredShellTheme = {
    theme: normalizeBaseTheme(record.theme, fallback),
    variant,
  }

  if (codeThemeId) {
    state.codeThemeId = codeThemeId
  }

  return state
}

function readStoredShellTheme(): StoredShellTheme {
  const fallbackVariant = readResolvedVariant()

  if (typeof window === "undefined") {
    return {
      theme: getDefaultBaseTheme(fallbackVariant),
      variant: fallbackVariant,
    }
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)

    if (stored) {
      return normalizeStoredTheme(JSON.parse(stored), fallbackVariant)
    }
  } catch {
    return {
      theme: getDefaultBaseTheme(fallbackVariant),
      variant: fallbackVariant,
    }
  }

  return {
    theme: getDefaultBaseTheme(fallbackVariant),
    variant: fallbackVariant,
  }
}

function persistShellTheme(state: StoredShellTheme) {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable in private or locked-down contexts.
  }
}

function resolveVariant(variant: string | undefined): ThemeVariant {
  return variant === "dark" ? "dark" : "light"
}

function applyAlphaPrecision(value: number) {
  return clamp(value, 0, 1).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function channelToHex(value: number) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")
}

function mixToHex(a: Rgb, b: Rgb, amount: number) {
  return rgbToHex(lerpRgb(a, b, amount))
}

function buildSurfaceUnder(
  theme: BaseTheme,
  surface: Rgb,
  ink: Rgb,
  variant: ThemeVariant
) {
  const baseline = DEFAULT_CONTRAST[variant]
  const amount =
    SURFACE_UNDER_OFFSET[variant] +
    (theme.contrast - baseline) * SURFACE_UNDER_CONTRAST_FACTOR[variant]

  return variant === "light"
    ? mixToHex(surface, ink, amount)
    : mixToHex(surface, BLACK, amount)
}

function buildPanelBackground(base: DerivedTheme) {
  const target = base.variant === "light" ? WHITE : base.ink

  return mixToHex(
    base.surface,
    target,
    PANEL_OFFSET[base.variant] +
      base.contrast * PANEL_CONTRAST_FACTOR[base.variant]
  )
}

function buildLightPalette(base: DerivedTheme): ThemePalette {
  const control = lerpRgb(base.surface, WHITE, 0.09 + base.contrast * 0.04)
  const elevatedSecondary = lerpRgb(
    base.surface,
    WHITE,
    0.08 + base.contrast * 0.08
  )
  const elevatedPrimary = lerpRgb(
    base.surface,
    WHITE,
    0.16 + base.contrast * 0.12
  )

  return {
    accentBackground: mixToHex(
      base.surface,
      base.accent,
      0.11 + base.contrast * 0.04
    ),
    accentBackgroundActive: mixToHex(
      base.surface,
      base.accent,
      0.13 + base.contrast * 0.05
    ),
    accentBackgroundHover: mixToHex(
      base.surface,
      base.accent,
      0.12 + base.contrast * 0.045
    ),
    border: alpha(base.ink, 0.06 + base.contrast * 0.04),
    borderFocus: base.theme.accent,
    borderHeavy: alpha(base.ink, 0.09 + base.contrast * 0.06),
    borderLight: alpha(base.ink, 0.04 + base.contrast * 0.02),
    buttonPrimaryBackground: base.theme.ink,
    buttonPrimaryBackgroundActive: alpha(base.ink, 0.1 + base.contrast * 0.12),
    buttonPrimaryBackgroundHover: alpha(base.ink, 0.05 + base.contrast * 0.06),
    buttonPrimaryBackgroundInactive: alpha(
      base.ink,
      0.18 + base.contrast * 0.14
    ),
    buttonSecondaryBackground: alpha(base.ink, 0.04 + base.contrast * 0.02),
    buttonSecondaryBackgroundActive: alpha(
      base.ink,
      0.03 + base.contrast * 0.02
    ),
    buttonSecondaryBackgroundHover: alpha(
      base.ink,
      0.04 + base.contrast * 0.03
    ),
    buttonSecondaryBackgroundInactive: alpha(
      base.ink,
      0.01 + base.contrast * 0.02
    ),
    buttonTertiaryBackground: alpha(base.ink, 0),
    buttonTertiaryBackgroundActive: alpha(
      base.ink,
      0.16 + base.contrast * 0.08
    ),
    buttonTertiaryBackgroundHover: alpha(base.ink, 0.08 + base.contrast * 0.04),
    controlBackground: alpha(control, 0.96),
    controlBackgroundOpaque: opaque(control),
    elevatedPrimary: alpha(elevatedPrimary, 0.96),
    elevatedPrimaryOpaque: opaque(elevatedPrimary),
    elevatedSecondary: alpha(elevatedSecondary, 0.96),
    elevatedSecondaryOpaque: opaque(elevatedSecondary),
    iconAccent: base.theme.accent,
    iconPrimary: base.theme.ink,
    iconSecondary: alpha(base.ink, 0.65 + base.contrast * 0.1),
    iconTertiary: alpha(base.ink, 0.45 + base.contrast * 0.1),
    simpleScrim: alpha(BLACK, 0.08 + base.contrast * 0.04),
    textAccent: base.theme.accent,
    textButtonPrimary: base.theme.surface,
    textButtonSecondary: base.theme.ink,
    textButtonTertiary: alpha(base.ink, 0.45 + base.contrast * 0.1),
    textForeground: base.theme.ink,
    textForegroundSecondary: alpha(base.ink, 0.65 + base.contrast * 0.1),
    textForegroundTertiary: alpha(base.ink, 0.45 + base.contrast * 0.1),
  }
}

function buildDarkPalette(base: DerivedTheme): ThemePalette {
  const control = lerpRgb(base.surface, base.ink, 0.06 + base.contrast * 0.05)
  const accentForeground = lerpRgb(
    base.accent,
    WHITE,
    0.3 + base.contrast * 0.15
  )
  const primaryButton = lerpRgb(
    base.surface,
    BLACK,
    0.38 + base.contrast * 0.12
  )
  const elevatedPrimary = lerpRgb(
    base.surface,
    base.ink,
    0.08 + base.contrast * 0.08
  )

  return {
    accentBackground: mixToHex(BLACK, base.accent, 0.2 + base.contrast * 0.08),
    accentBackgroundActive: mixToHex(
      BLACK,
      base.accent,
      0.22 + base.contrast * 0.12
    ),
    accentBackgroundHover: mixToHex(
      BLACK,
      base.accent,
      0.21 + base.contrast * 0.1
    ),
    border: alpha(base.ink, 0.06 + base.contrast * 0.04),
    borderFocus: alpha(accentForeground, 0.7 + base.contrast * 0.1),
    borderHeavy: alpha(base.ink, 0.12 + base.contrast * 0.06),
    borderLight: alpha(base.ink, 0.03 + base.contrast * 0.02),
    buttonPrimaryBackground: opaque(primaryButton),
    buttonPrimaryBackgroundActive: alpha(base.ink, 0.07 + base.contrast * 0.05),
    buttonPrimaryBackgroundHover: alpha(base.ink, 0.04 + base.contrast * 0.03),
    buttonPrimaryBackgroundInactive: alpha(
      base.ink,
      0.02 + base.contrast * 0.02
    ),
    buttonSecondaryBackground: alpha(base.ink, 0.04 + base.contrast * 0.02),
    buttonSecondaryBackgroundActive: alpha(
      base.ink,
      0.09 + base.contrast * 0.05
    ),
    buttonSecondaryBackgroundHover: alpha(
      base.ink,
      0.06 + base.contrast * 0.03
    ),
    buttonSecondaryBackgroundInactive: alpha(
      base.ink,
      0.02 + base.contrast * 0.03
    ),
    buttonTertiaryBackground: alpha(base.ink, 0.02 + base.contrast * 0.015),
    buttonTertiaryBackgroundActive: alpha(
      base.ink,
      0.07 + base.contrast * 0.05
    ),
    buttonTertiaryBackgroundHover: alpha(base.ink, 0.05 + base.contrast * 0.03),
    controlBackground: alpha(control, 0.96),
    controlBackgroundOpaque: opaque(control),
    elevatedPrimary: alpha(elevatedPrimary, 0.96),
    elevatedPrimaryOpaque: opaque(elevatedPrimary),
    elevatedSecondary: alpha(base.ink, 0.02 + base.contrast * 0.02),
    elevatedSecondaryOpaque: mixToHex(
      base.surface,
      base.ink,
      0.04 + base.contrast * 0.05
    ),
    iconAccent: opaque(accentForeground),
    iconPrimary: alpha(base.ink, 0.82 + base.contrast * 0.14),
    iconSecondary: alpha(base.ink, 0.65 + base.contrast * 0.1),
    iconTertiary: alpha(base.ink, 0.45 + base.contrast * 0.1),
    simpleScrim: alpha(base.ink, 0.08 + base.contrast * 0.04),
    textAccent: opaque(accentForeground),
    textButtonPrimary: opaque(primaryButton),
    textButtonSecondary: mixToHex(
      base.ink,
      base.surface,
      0.7 + base.contrast * 0.1
    ),
    textButtonTertiary: alpha(base.ink, 0.45 + base.contrast * 0.1),
    textForeground: base.theme.ink,
    textForegroundSecondary: alpha(base.ink, 0.65 + base.contrast * 0.1),
    textForegroundTertiary: alpha(base.ink, 0.42 + base.contrast * 0.13),
  }
}

function ShellThemeProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme()
  const [state, setState] = React.useState<StoredShellTheme>(() =>
    readStoredShellTheme()
  )
  const resolvedVariant = resolveVariant(resolvedTheme)
  const shellState = React.useMemo<StoredShellTheme>(() => {
    if (state.variant === resolvedVariant) {
      return state
    }

    return {
      codeThemeId: state.codeThemeId,
      theme: getDefaultBaseTheme(resolvedVariant),
      variant: resolvedVariant,
    }
  }, [resolvedVariant, state])

  React.useInsertionEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    applyTheme(document.documentElement, shellState.theme, shellState.variant)
  }, [shellState.theme, shellState.variant])

  const setBaseTheme = React.useCallback<
    ShellThemeContextValue["setBaseTheme"]
  >((nextTheme) => {
    setState((current) => {
      const currentVariant =
        current.variant === resolvedVariant ? current.variant : resolvedVariant
      const currentTheme =
        current.variant === resolvedVariant
          ? current.theme
          : getDefaultBaseTheme(resolvedVariant)
      const rawTheme =
        typeof nextTheme === "function" ? nextTheme(currentTheme) : nextTheme
      const next = {
        codeThemeId: current.codeThemeId,
        theme: normalizeBaseTheme(
          rawTheme,
          getDefaultBaseTheme(currentVariant)
        ),
        variant: currentVariant,
      }

      persistShellTheme(next)

      return next
    })
  }, [resolvedVariant])

  const value = React.useMemo<ShellThemeContextValue>(
    () => ({
      ...shellState,
      baseTheme: shellState.theme,
      setBaseTheme,
    }),
    [setBaseTheme, shellState]
  )

  return React.createElement(ShellThemeContext.Provider, { value }, children)
}

function useShellTheme() {
  const value = React.useContext(ShellThemeContext)

  if (!value) {
    throw new Error("useShellTheme must be used within ShellThemeProvider.")
  }

  return value
}

function hexToRgb(hex: string): Rgb {
  const value = hex.slice(1)

  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16),
  }
}

function rgbToHex(rgb: Rgb) {
  return `#${channelToHex(rgb.red)}${channelToHex(rgb.green)}${channelToHex(rgb.blue)}`
}

function lerpRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp(amount, 0, 1)

  return {
    red: Math.round(a.red + (b.red - a.red) * t),
    green: Math.round(a.green + (b.green - a.green) * t),
    blue: Math.round(a.blue + (b.blue - a.blue) * t),
  }
}

function mixHex(a: string, b: string, amount: number) {
  return rgbToHex(lerpRgb(hexToRgb(a), hexToRgb(b), amount))
}

function alpha(rgb: Rgb, amount: number) {
  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${applyAlphaPrecision(amount)})`
}

function opaque(rgb: Rgb) {
  return `rgb(${rgb.red}, ${rgb.green}, ${rgb.blue})`
}

function normalizeContrast(contrast: number, variant: ThemeVariant) {
  const baseline = DEFAULT_CONTRAST[variant]
  const normalized = contrast / 100 + ((contrast - baseline) / 60) * 0.7

  if (contrast <= baseline) {
    return normalized
  }

  const baselineRatio = baseline / 100

  return baselineRatio + (normalized - baselineRatio) * 2
}

function deriveBaseTheme(
  theme: BaseTheme,
  variant: ThemeVariant
): DerivedTheme {
  const normalizedContrast = normalizeContrast(theme.contrast, variant)
  const surface = hexToRgb(theme.surface)
  const ink = hexToRgb(theme.ink)

  return {
    accent: hexToRgb(theme.accent),
    contrast: normalizedContrast,
    editorBackground:
      variant === "light"
        ? lerpRgb(surface, WHITE, 0.12)
        : lerpRgb(surface, ink, 0.07),
    ink,
    surface,
    surfaceUnder: buildSurfaceUnder(theme, surface, ink, variant),
    theme,
    variant,
  }
}

function buildPalette(base: DerivedTheme) {
  return base.variant === "light"
    ? buildLightPalette(base)
    : buildDarkPalette(base)
}

function buildCssVariables(
  base: DerivedTheme,
  palette: ThemePalette
): CssVariables {
  return {
    "--shell-base-accent": base.theme.accent,
    "--shell-base-contrast": String(base.theme.contrast),
    "--shell-base-ink": base.theme.ink,
    "--shell-base-surface": base.theme.surface,
    "--color-accent-blue": base.theme.accent,
    "--color-accent-purple": base.theme.semanticColors.skill,
    "--color-background-accent": palette.accentBackground,
    "--color-background-accent-active": palette.accentBackgroundActive,
    "--color-background-accent-hover": palette.accentBackgroundHover,
    "--color-background-button-primary": palette.buttonPrimaryBackground,
    "--color-background-button-primary-active":
      palette.buttonPrimaryBackgroundActive,
    "--color-background-button-primary-hover":
      palette.buttonPrimaryBackgroundHover,
    "--color-background-button-primary-inactive":
      palette.buttonPrimaryBackgroundInactive,
    "--color-background-button-secondary": palette.buttonSecondaryBackground,
    "--color-background-button-secondary-active":
      palette.buttonSecondaryBackgroundActive,
    "--color-background-button-secondary-hover":
      palette.buttonSecondaryBackgroundHover,
    "--color-background-button-secondary-inactive":
      palette.buttonSecondaryBackgroundInactive,
    "--color-background-button-tertiary": palette.buttonTertiaryBackground,
    "--color-background-button-tertiary-active":
      palette.buttonTertiaryBackgroundActive,
    "--color-background-button-tertiary-hover":
      palette.buttonTertiaryBackgroundHover,
    "--color-background-control": palette.controlBackground,
    "--color-background-control-opaque": palette.controlBackgroundOpaque,
    "--color-background-editor-opaque": opaque(base.editorBackground),
    "--color-background-elevated-primary": palette.elevatedPrimary,
    "--color-background-elevated-primary-opaque": palette.elevatedPrimaryOpaque,
    "--color-background-elevated-secondary": palette.elevatedSecondary,
    "--color-background-elevated-secondary-opaque":
      palette.elevatedSecondaryOpaque,
    "--color-background-panel": buildPanelBackground(base),
    "--color-background-surface": base.theme.surface,
    "--color-background-surface-under": base.surfaceUnder,
    "--color-border": palette.border,
    "--color-border-focus": palette.borderFocus,
    "--color-border-heavy": palette.borderHeavy,
    "--color-border-light": palette.borderLight,
    "--color-decoration-added": base.theme.semanticColors.diffAdded,
    "--color-decoration-deleted": base.theme.semanticColors.diffRemoved,
    "--color-editor-added": alpha(
      hexToRgb(base.theme.semanticColors.diffAdded),
      base.variant === "light" ? 0.15 : 0.23
    ),
    "--color-editor-deleted": alpha(
      hexToRgb(base.theme.semanticColors.diffRemoved),
      base.variant === "light" ? 0.15 : 0.23
    ),
    "--color-icon-accent": palette.iconAccent,
    "--color-icon-primary": palette.iconPrimary,
    "--color-icon-secondary": palette.iconSecondary,
    "--color-icon-tertiary": palette.iconTertiary,
    "--color-simple-scrim": palette.simpleScrim,
    "--color-text-accent": palette.textAccent,
    "--color-text-button-primary": palette.textButtonPrimary,
    "--color-text-button-secondary": palette.textButtonSecondary,
    "--color-text-button-tertiary": palette.textButtonTertiary,
    "--color-text-foreground": palette.textForeground,
    "--color-text-foreground-secondary": palette.textForegroundSecondary,
    "--color-text-foreground-tertiary": palette.textForegroundTertiary,
  }
}

function createCssVariables(theme: BaseTheme, variant: ThemeVariant) {
  const base = deriveBaseTheme(theme, variant)

  return buildCssVariables(base, buildPalette(base))
}

function applyTheme(
  element: HTMLElement,
  theme: BaseTheme,
  variant: ThemeVariant
) {
  const variables = createCssVariables(theme, variant)

  element.classList.toggle("dark", variant === "dark")

  Object.entries(variables).forEach(([name, value]) => {
    element.style.removeProperty(name)
    element.style.setProperty(name, value)
  })
}

export {
  BLACK,
  DEFAULT_BASE_THEMES,
  STORAGE_KEY as SHELL_THEME_STORAGE_KEY,
  ShellThemeProvider,
  WHITE,
  alpha,
  applyTheme,
  buildCssVariables,
  buildPalette,
  createCssVariables,
  deriveBaseTheme,
  hexToRgb,
  lerpRgb,
  mixHex,
  normalizeContrast,
  opaque,
  rgbToHex,
  useShellTheme,
  type BaseTheme,
  type CssVariables,
  type Rgb,
  type StoredShellTheme,
  type ThemePalette,
  type ThemeVariant,
}
