import * as React from "react"

import { RiCheckLine, RiEditLine, RiLoader4Line } from "@remixicon/react"

import { DialogIconHeader } from "@/components/dialog-icon-header"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { CodeBoxSandbox } from "../types"
import { getRepoName } from "../utils"

export function RenameSandboxDialog({
  sandbox,
  value,
  busy,
  onValueChange,
  onOpenChange,
  onSave,
}: {
  sandbox: CodeBoxSandbox | null
  value: string
  busy: boolean
  onValueChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSave: () => void
}) {
  const { t } = useI18n()
  const fallbackName = sandbox?.repoUrl
    ? getRepoName(sandbox.repoUrl)
    : (sandbox?.sandboxId ?? "")

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave()
  }

  return (
    <Dialog open={Boolean(sandbox)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5">
        <DialogIconHeader
          icon={<RiEditLine className="size-5" aria-hidden />}
          title={t.codeboxRenameSandboxTitle}
          description={t.codeboxRenameSandboxDescription}
        />

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="codebox-rename">
              {t.codeboxSandboxNamePlaceholder}
            </label>
            <Input
              id="codebox-rename"
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={fallbackName}
              maxLength={64}
              autoComplete="off"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t.codeboxCancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <RiLoader4Line className="animate-spin" /> : <RiCheckLine />}
              {t.studioSave}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
