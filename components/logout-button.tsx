"use client"

import * as React from "react"
import { RiLogoutBoxRLine, RiLoader4Line } from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"

async function logout() {
  const response = await fetch("/api/studio/oauth/logout", {
    method: "POST",
  })

  if (!response.ok) {
    throw new Error("Logout failed")
  }
}

function LogoutButton() {
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)

  async function handleLogout() {
    try {
      setPending(true)
      await logout()
      window.location.replace("/login")
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      disabled={pending}
      aria-label={t.logout}
      title={t.logout}
    >
      {pending ? (
        <RiLoader4Line data-icon="inline-start" className="animate-spin" />
      ) : (
        <RiLogoutBoxRLine data-icon="inline-start" />
      )}
      <span>{t.logout}</span>
    </Button>
  )
}

export { LogoutButton }
