"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  GaugeIcon,
  MousePointerClickIcon,
  MessageSquareTextIcon,
  RadioTowerIcon,
  SparklesIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const navigation = [
  { title: "总览", href: "/dashboard", icon: GaugeIcon },
  { title: "行为分析", href: "/analytics", icon: MousePointerClickIcon },
  { title: "反馈", href: "/feedback", icon: MessageSquareTextIcon },
  { title: "渠道", href: "/channels", icon: RadioTowerIcon },
]

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="px-3 py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/dashboard">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <SparklesIcon aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="font-heading text-base font-semibold">
                    AstraFlow Control
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Distribution operations
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>工作台</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(item.href)}
                    tooltip={item.title}
                  >
                    <Link href={item.href}>
                      <item.icon aria-hidden />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
