import type { NextConfig } from "next"

const basePath = (
  process.env.NEXT_PUBLIC_ASTRAFLOW_ADMIN_BASE_PATH ?? ""
).replace(/\/+$/, "")

const nextConfig: NextConfig = {
  basePath,
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
}

export default nextConfig
