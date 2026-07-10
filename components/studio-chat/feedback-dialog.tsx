"use client"

import * as React from "react"
import {
  RiDeleteBinLine,
  RiImageAddLine,
  RiInformationLine,
  RiLoader4Line,
} from "@remixicon/react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { createClientId } from "@/lib/utils"

import { listMessages, submitStudioFeedback } from "./api"
import { readFileAsDataUrl } from "./attachment-utils"

const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

type FeedbackImage = {
  id: string
  name: string
  mimeType: string
  size: number
  dataUrl: string
}

export type StudioFeedbackTarget = {
  entryPoint: "message_action" | "titlebar"
  messageId: string | null
}

export function StudioFeedbackDialog({
  open,
  onOpenChange,
  sessionId,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  target: StudioFeedbackTarget
}) {
  const { locale, t } = useI18n()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [description, setDescription] = React.useState("")
  const [images, setImages] = React.useState<FeedbackImage[]>([])
  const [descriptionInvalid, setDescriptionInvalid] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  function reset() {
    setDescription("")
    setImages([])
    setDescriptionInvalid(false)
    if (inputRef.current) {
      inputRef.current.value = ""
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (submitting) {
      return
    }
    if (!nextOpen) {
      reset()
    }
    onOpenChange(nextOpen)
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) {
      return
    }

    const remaining = MAX_IMAGES - images.length
    if (files.length > remaining) {
      toast.error(t.studioFeedbackTooManyImages)
    }

    const accepted: FeedbackImage[] = []
    for (const file of Array.from(files).slice(0, remaining)) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        toast.error(t.studioFeedbackUnsupportedImage)
        continue
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(t.studioFeedbackImageTooLarge)
        continue
      }

      try {
        accepted.push({
          id: createClientId(),
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
        })
      } catch {
        toast.error(t.studioFeedbackFailed)
      }
    }

    setImages((current) => [...current, ...accepted].slice(0, MAX_IMAGES))
    if (inputRef.current) {
      inputRef.current.value = ""
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedDescription = description.trim()
    if (!trimmedDescription) {
      setDescriptionInvalid(true)
      return
    }

    setDescriptionInvalid(false)
    setSubmitting(true)
    try {
      const messages = await listMessages(sessionId)
      await submitStudioFeedback({
        sessionId,
        targetMessageId: target.messageId,
        entryPoint: target.entryPoint,
        description: trimmedDescription,
        messages,
        images: images.map(({ name, mimeType, dataUrl }) => ({
          name,
          mimeType,
          dataUrl,
        })),
        locale,
      })
      toast.success(t.studioFeedbackSent)
      reset()
      onOpenChange(false)
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t.studioFeedbackFailed
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.studioFeedbackTitle}</DialogTitle>
          <DialogDescription>{t.studioFeedbackDescription}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <FieldGroup className="gap-5">
            <Field data-invalid={descriptionInvalid || undefined}>
              <FieldLabel htmlFor="studio-feedback-description">
                {t.studioFeedbackDetails}
              </FieldLabel>
              <Textarea
                id="studio-feedback-description"
                value={description}
                maxLength={4000}
                rows={6}
                aria-invalid={descriptionInvalid || undefined}
                placeholder={t.studioFeedbackPlaceholder}
                disabled={submitting}
                onChange={(event) => {
                  setDescription(event.target.value)
                  if (descriptionInvalid && event.target.value.trim()) {
                    setDescriptionInvalid(false)
                  }
                }}
              />
              <FieldError>
                {descriptionInvalid
                  ? t.studioFeedbackDescriptionRequired
                  : null}
              </FieldError>
            </Field>

            <Field>
              <FieldLabel>{t.studioFeedbackImages}</FieldLabel>
              {images.length > 0 ? (
                <div className="grid grid-cols-3 gap-3">
                  {images.map((image) => (
                    <div
                      key={image.id}
                      className="relative aspect-square overflow-hidden rounded-2xl border bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.dataUrl}
                        alt={image.name}
                        className="size-full object-cover"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon-xs"
                        className="absolute top-2 right-2"
                        aria-label={`${t.studioFeedbackRemoveImage}: ${image.name}`}
                        disabled={submitting}
                        onClick={() =>
                          setImages((current) =>
                            current.filter((item) => item.id !== image.id)
                          )
                        }
                      >
                        <RiDeleteBinLine aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="sr-only"
                  disabled={submitting || images.length >= MAX_IMAGES}
                  onChange={(event) => void handleFiles(event.target.files)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting || images.length >= MAX_IMAGES}
                  onClick={() => inputRef.current?.click()}
                >
                  <RiImageAddLine data-icon="inline-start" aria-hidden />
                  {t.studioFeedbackAddImages}
                </Button>
              </div>
              <FieldDescription>{t.studioFeedbackImageHelp}</FieldDescription>
            </Field>
          </FieldGroup>

          <Alert>
            <RiInformationLine aria-hidden />
            <AlertDescription>
              {t.studioFeedbackConversationNotice}
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => handleOpenChange(false)}
            >
              {t.studioFeedbackCancel}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <RiLoader4Line
                  data-icon="inline-start"
                  className="animate-spin"
                  aria-hidden
                />
              ) : null}
              {submitting ? t.studioFeedbackSubmitting : t.studioFeedbackSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
