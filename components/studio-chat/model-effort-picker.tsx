"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, Zap } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Slider } from "@/components/ui/slider"
import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import type { ChatReasoningEffort, SupportedChatModel } from "@/lib/chat-models"
import { cn } from "@/lib/utils"

type ReasoningOption = {
  value: ChatReasoningEffort
  label: string
  description: string
}

type PickerCopy = {
  advanced: string
  effort: string
  maxUsage: string
  model: string
}

type ModelEffortPickerProps = {
  copy: PickerCopy
  dense: boolean
  disabled: boolean
  effort: ChatReasoningEffort
  effortLabel: string
  iconOnly: boolean
  model: SupportedChatModel
  modelLabel: string
  modelOptions: AgentModelDefinition[]
  modelSelectOpen: boolean
  onEffortChange: (effort: ChatReasoningEffort) => void
  onModelChange: (model: SupportedChatModel) => void
  onModelSelectOpenChange: (open: boolean) => void
  onReasoningSelectOpenChange: (open: boolean) => void
  reasoningOptions: ReasoningOption[]
  reasoningSelectOpen: boolean
  title: string
}

type PickerSubmenu = "model" | "effort" | null

export function ModelEffortPicker({
  copy,
  dense,
  disabled,
  effort,
  effortLabel,
  iconOnly,
  model,
  modelLabel,
  modelOptions,
  modelSelectOpen,
  onEffortChange,
  onModelChange,
  onModelSelectOpenChange,
  onReasoningSelectOpenChange,
  reasoningOptions,
  reasoningSelectOpen,
  title,
}: ModelEffortPickerProps) {
  const [activeSubmenu, setActiveSubmenu] = React.useState<PickerSubmenu>(null)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const open = modelSelectOpen || reasoningSelectOpen
  const selectedReasoningIndex = Math.max(
    0,
    reasoningOptions.findIndex((option) => option.value === effort)
  )
  const pickerModelLabel = modelLabel

  function handleOpenChange(nextOpen: boolean) {
    onModelSelectOpenChange(nextOpen)

    if (!nextOpen) {
      onReasoningSelectOpenChange(false)
      setActiveSubmenu(null)
      setAdvancedOpen(false)
    }
  }

  function handleSubmenuChange(
    submenu: Exclude<PickerSubmenu, null>,
    nextOpen: boolean
  ) {
    if (submenu === "effort") {
      onReasoningSelectOpenChange(nextOpen)
    } else if (nextOpen) {
      onReasoningSelectOpenChange(false)
    }

    setActiveSubmenu(nextOpen ? submenu : null)
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-tour-id="studio-composer-model"
          className={cn(
            "h-7 max-w-48 min-w-0 rounded-full bg-transparent px-3 text-xs font-normal text-foreground hover:bg-muted aria-expanded:bg-muted",
            iconOnly && "max-w-[5.5rem] px-2",
            dense && "h-6 max-w-[4.25rem] px-2 text-[11px]"
          )}
          aria-label={title}
          title={title}
        >
          <span className="min-w-0 truncate">{pickerModelLabel}</span>
          {!iconOnly ? (
            <span className="shrink-0 text-muted-foreground">
              {effortLabel}
            </span>
          ) : null}
          <ChevronDown
            aria-hidden
            className="ml-1 size-3.5 shrink-0 text-muted-foreground"
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={6}
        className="w-48 gap-0.5 rounded-xl p-1.5"
      >
        <DropdownMenuSub
          open={activeSubmenu === "model"}
          onOpenChange={(nextOpen) => handleSubmenuChange("model", nextOpen)}
        >
          <DropdownMenuSubTrigger className="h-8 rounded-lg px-2.5 text-xs">
            <span className="min-w-0 flex-1 truncate">{copy.model}</span>
            <span className="max-w-28 truncate text-muted-foreground">
              {pickerModelLabel}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            sideOffset={6}
            className="max-h-72 w-56 overflow-y-auto rounded-xl p-1.5"
          >
            <DropdownMenuLabel className="px-2.5 py-1 text-xs">
              {copy.model}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={model}
              onValueChange={(nextModel) =>
                onModelChange(nextModel as SupportedChatModel)
              }
            >
              {modelOptions.map((option) => (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={option.id}
                  className="min-h-8 rounded-lg px-2.5 pr-8 text-xs hover:bg-token-list-hover-background data-[state=checked]:bg-token-list-hover-background"
                >
                  <span className="truncate">{option.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub
          open={reasoningSelectOpen || activeSubmenu === "effort"}
          onOpenChange={(nextOpen) => handleSubmenuChange("effort", nextOpen)}
        >
          <DropdownMenuSubTrigger
            disabled={reasoningOptions.length <= 1}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            <span className="min-w-0 flex-1 truncate">{copy.effort}</span>
            <span className="max-w-28 truncate text-muted-foreground">
              {effortLabel}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            sideOffset={6}
            className="w-48 rounded-xl p-1.5"
          >
            <DropdownMenuLabel className="px-2.5 py-1 text-xs">
              {copy.effort}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={effort}
              onValueChange={(nextEffort) =>
                onEffortChange(nextEffort as ChatReasoningEffort)
              }
            >
              {reasoningOptions.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  title={option.description}
                  className="min-h-8 rounded-lg px-2.5 pr-8 text-xs hover:bg-token-list-hover-background data-[state=checked]:bg-token-list-hover-background"
                >
                  <span className="flex min-w-0 flex-col">
                    <span>{option.label}</span>
                    {option.value === "max" ? (
                      <span className="text-[11px] leading-3.5 text-muted-foreground">
                        {copy.maxUsage}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {reasoningOptions.length > 1 ? (
          <>
            <DropdownMenuSeparator className="mx-2 my-1" />
            <DropdownMenuItem
              className="h-8 rounded-lg px-2.5 text-xs text-muted-foreground"
              onSelect={(event) => {
                event.preventDefault()
                setAdvancedOpen((current) => !current)
              }}
            >
              <span className="flex-1">{copy.advanced}</span>
              {advancedOpen ? (
                <ChevronUp aria-hidden className="size-3.5" />
              ) : (
                <ChevronDown aria-hidden className="size-3.5" />
              )}
              <Zap aria-hidden className="ml-1 size-3.5" />
            </DropdownMenuItem>
            {advancedOpen ? (
              <div
                className="px-2.5 pt-2.5 pb-1.5"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Slider
                  aria-label={copy.effort}
                  min={0}
                  max={reasoningOptions.length - 1}
                  step={1}
                  value={[selectedReasoningIndex]}
                  onValueChange={([nextIndex]) => {
                    const option = reasoningOptions[nextIndex]

                    if (option) {
                      onEffortChange(option.value)
                    }
                  }}
                  className="py-1 [&_[data-slot=slider-thumb]]:h-3.5 [&_[data-slot=slider-thumb]]:w-5 [&_[data-slot=slider-track]]:h-1.5"
                />
              </div>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
