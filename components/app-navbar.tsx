"use client"

import { usePathname } from "next/navigation"

import { Navbar } from "@/components/navbar"

function AppNavbar() {
  const pathname = usePathname()

  if (pathname === "/login") {
    return null
  }

  return <Navbar />
}

export { AppNavbar }
