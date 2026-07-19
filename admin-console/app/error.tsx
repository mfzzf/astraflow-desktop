"use client"

import { TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg shadow-xs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading text-2xl">
            <TriangleAlertIcon aria-hidden />
            管理 API 暂不可用
          </CardTitle>
          <CardDescription>
            请检查管理台与后端的 API 地址和 ASTRAFLOW_ADMIN_API_KEY。
          </CardDescription>
        </CardHeader>
        <CardContent className="font-mono text-xs text-muted-foreground">
          {error.message}
        </CardContent>
        <CardFooter>
          <Button onClick={reset}>重新加载</Button>
        </CardFooter>
      </Card>
    </div>
  )
}
