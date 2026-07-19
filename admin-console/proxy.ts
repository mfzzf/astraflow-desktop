import { NextResponse, type NextRequest } from "next/server"

import { verifyAdminUIAuthorization } from "@/lib/admin-ui-auth-shared"

export function proxy(request: NextRequest) {
  const result = verifyAdminUIAuthorization(
    request.headers.get("authorization")
  )

  if (result === "authorized") {
    return NextResponse.next()
  }
  if (result === "unconfigured") {
    return new NextResponse("Admin UI authentication is not configured.", {
      status: 503,
    })
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AstraFlow Control"' },
  })
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
}
