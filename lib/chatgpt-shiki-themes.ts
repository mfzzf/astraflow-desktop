import type { ThemeRegistration } from "shiki"

const sharedTokenColors: ThemeRegistration["tokenColors"] = [
  {
    scope: ["comment", "punctuation.definition.comment"],
    settings: { foreground: "#5d6c79" },
  },
  {
    scope: ["string", "constant.other.symbol"],
    settings: { foreground: "#c41a16" },
  },
  {
    scope: [
      "keyword",
      "keyword.control",
      "storage",
      "storage.type",
      "storage.modifier",
    ],
    settings: { foreground: "#9b2393" },
  },
  {
    scope: [
      "constant.numeric",
      "constant.language",
      "constant.character.escape",
    ],
    settings: { foreground: "#1c00cf" },
  },
  {
    scope: [
      "entity.name.type",
      "entity.name.class",
      "support.type",
      "support.class",
    ],
    settings: { foreground: "#0b4f79" },
  },
  {
    scope: [
      "support.function",
      "entity.name.function",
      "meta.function-call",
      "variable.function",
    ],
    settings: { foreground: "#326d74" },
  },
  {
    scope: [
      "variable",
      "identifier",
      "meta.definition.variable",
      "support.variable.property",
    ],
    settings: { foreground: "#326d74" },
  },
  {
    scope: ["markup.underline.link", "markup.underline.link.markdown"],
    settings: { foreground: "#0e0eff" },
  },
]

/** Decoded from ChatGPT Desktop's bundled Xcode Light theme. */
export const chatGptXcodeLightTheme: ThemeRegistration = {
  name: "astraflow-chatgpt-xcode-light",
  type: "light",
  colors: {
    "activityBar.activeBorder": "#0e0eff",
    "activityBar.background": "#ffffff",
    "activityBarBadge.background": "#0e0eff",
    "button.background": "#0e0eff",
    "editor.background": "#ffffff",
    "editor.foreground": "#000000d9",
    "editor.lineHighlightBackground": "#e8f2ff",
    "editor.selectionBackground": "#a4cdff",
    "editorWhitespace.foreground": "#cccccc",
    "editorCursor.foreground": "#0e0eff",
    "editorGroupHeader.tabsBackground": "#ffffff",
    focusBorder: "#0e0eff",
    foreground: "#000000d9",
    "panel.background": "#ffffff",
    "sideBar.background": "#ffffff",
    "sideBar.foreground": "#000000d9",
    "sideBarTitle.foreground": "#000000d9",
    "textLink.foreground": "#0e0eff",
  },
  tokenColors: sharedTokenColors,
}

/** Decoded from ChatGPT Desktop's bundled Xcode Dark theme. */
export const chatGptXcodeDarkTheme: ThemeRegistration = {
  name: "astraflow-chatgpt-xcode-dark",
  type: "dark",
  colors: {
    "activityBar.activeBorder": "#5482ff",
    "activityBar.background": "#1f1f24",
    "activityBarBadge.background": "#5482ff",
    "button.background": "#5482ff",
    "editor.background": "#1f1f24",
    "editor.foreground": "#ffffffd9",
    "editor.lineHighlightBackground": "#23252b",
    "editor.selectionBackground": "#515b70",
    "editorWhitespace.foreground": "#424d5b",
    "editorCursor.foreground": "#5482ff",
    "editorGroupHeader.tabsBackground": "#1f1f24",
    focusBorder: "#5482ff",
    foreground: "#ffffffd9",
    "panel.background": "#1f1f24",
    "sideBar.background": "#1f1f24",
    "sideBar.foreground": "#ffffffd9",
    "sideBarTitle.foreground": "#ffffffd9",
    "textLink.foreground": "#5482ff",
  },
  tokenColors: sharedTokenColors.map((token) => {
    const foregroundMap: Record<string, string> = {
      "#5d6c79": "#6c7986",
      "#c41a16": "#fc6a5d",
      "#9b2393": "#fc5fa3",
      "#1c00cf": "#d0bf69",
      "#0b4f79": "#5dd8ff",
      "#326d74": "#67b7a4",
      "#0e0eff": "#5482ff",
    }

    return {
      ...token,
      settings: {
        ...token.settings,
        foreground:
          foregroundMap[token.settings.foreground ?? ""] ??
          token.settings.foreground,
      },
    }
  }),
}
