import * as React from "react"
import { IconLoader2, IconMicrophone } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"

export const ComposerVoiceButton = React.memo(function ComposerVoiceButton({
  disabled,
  isTranscribing,
  label,
  onClick,
}: {
  disabled?: boolean
  isTranscribing: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="size-7 shrink-0 rounded-full p-0 hover:bg-muted/60 [&_svg]:size-4"
      disabled={disabled || isTranscribing}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {isTranscribing ? (
        <IconLoader2 aria-hidden className="animate-spin" />
      ) : (
        <IconMicrophone aria-hidden />
      )}
    </Button>
  )
})
