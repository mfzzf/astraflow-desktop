import type { WebviewTag } from "electron"
import type * as React from "react"

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<WebviewTag>,
        WebviewTag
      > & {
        partition?: string
        src?: string
      }
    }
  }
}
