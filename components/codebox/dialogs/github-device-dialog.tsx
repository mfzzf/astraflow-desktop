import * as React from "react"
import { RiArrowRightUpLine, RiCheckLine, RiFileCopyLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n } from "@/components/i18n-provider"
import { GithubDeviceFlow } from "../types"
import { formatDate } from "../utils"

export function GithubDeviceDialog({
  open,
  onOpenChange,
  flow,
  message,
  onCopy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flow: GithubDeviceFlow | null
  message: string
  onCopy: (value: string | null | undefined) => Promise<boolean>
}) {
  const { locale, t } = useI18n()
  const [copyState, setCopyState] = React.useState<{
    userCode: string | null
    status: "idle" | "copied" | "blocked"
  }>({
    userCode: null,
    status: "idle",
  })
  const activeCopyStatus =
    open && copyState.userCode === flow?.userCode ? copyState.status : "idle"

  async function handleCopyCode() {
    if (!flow?.userCode) {
      return
    }

    setCopyState({
      userCode: flow.userCode,
      status: (await onCopy(flow.userCode)) ? "copied" : "blocked",
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.codeboxConnectGithubTitle}</DialogTitle>
          <DialogDescription>
            {t.codeboxConnectGithubDescription}
          </DialogDescription>
        </DialogHeader>

        {flow ? (
          <div className="grid gap-3">
            <div className="rounded-2xl border bg-background p-4 text-center">
              <div className="text-xs font-medium text-muted-foreground uppercase">
                {t.codeboxDeviceCode}
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tracking-normal">
                {flow.userCode}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void handleCopyCode()}
              >
                {activeCopyStatus === "copied" ? <RiCheckLine /> : <RiFileCopyLine />}
                {activeCopyStatus === "copied" ? t.copied : t.codeboxCopyCode}
              </Button>
              {activeCopyStatus === "blocked" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t.codeboxCopyBlocked}
                </p>
              ) : null}
            </div>

            <Button asChild>
              <a href={flow.verificationUri} target="_blank" rel="noreferrer">
                {t.codeboxOpenGithub}
                <RiArrowRightUpLine />
              </a>
            </Button>

            <p className="text-sm text-muted-foreground">
              {message || t.codeboxExpiresAt(formatDate(flow.expiresAt, locale))}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {message || t.codeboxNoActiveGithubFlow}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
