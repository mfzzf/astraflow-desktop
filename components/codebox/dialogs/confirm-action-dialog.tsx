import { RiDeleteBin6Line } from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { ConfirmAction } from "../types"
import { getRepoName } from "../utils"

export function ConfirmActionDialog({
  action,
  onOpenChange,
  confirmSandboxId,
  onConfirmSandboxIdChange,
  onConfirm,
}: {
  action: ConfirmAction | null
  onOpenChange: (open: boolean) => void
  confirmSandboxId: string
  onConfirmSandboxIdChange: (value: string) => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const target = action?.sandbox.repoUrl
    ? getRepoName(action.sandbox.repoUrl)
    : (action?.sandbox.sandboxId ?? "")
  const expectedSandboxId = action?.sandbox.sandboxId ?? ""
  const canConfirm =
    Boolean(expectedSandboxId) && confirmSandboxId.trim() === expectedSandboxId

  return (
    <Dialog open={Boolean(action)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <RiDeleteBin6Line className="size-5" aria-hidden />
          </div>
          <DialogTitle>{t.codeboxKillSandboxTitle}</DialogTitle>
          <DialogDescription>
            {t.codeboxKillSandboxConfirm(target)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="codebox-kill-confirm">
            {t.codeboxConfirmSandboxIdLabel}
          </label>
          <Input
            id="codebox-kill-confirm"
            value={confirmSandboxId}
            onChange={(event) => onConfirmSandboxIdChange(event.target.value)}
            placeholder={expectedSandboxId}
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.codeboxCancel}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            <RiDeleteBin6Line />
            {t.codeboxKill}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
