interface AppIconProps {
  className?: string
}

/** AstraFlow 应用图标：深色圆角方块 + 流动曲线 + 星点 */
export default function AppIcon({ className = 'h-24 w-24' }: AppIconProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className={className} aria-label="AstraFlow">
      <defs>
        <linearGradient id="appicon-bg" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1e1b4b" />
          <stop offset="1" stopColor="#0f0a1e" />
        </linearGradient>
        <linearGradient id="appicon-flow" x1="20" y1="80" x2="100" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="0.5" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="28" fill="url(#appicon-bg)" />
      <rect width="120" height="120" rx="28" fill="black" fillOpacity="0.08" />
      {/* 流动曲线 */}
      <path
        d="M28 78c16-6 28-22 48-22 10 0 18 6 22 14"
        stroke="url(#appicon-flow)"
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M34 92c20-8 34-30 56-30 8 0 14 4 18 10"
        stroke="url(#appicon-flow)"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
      {/* 星点 */}
      <circle cx="90" cy="36" r="5" fill="#22d3ee" />
      <circle cx="34" cy="52" r="3" fill="#a78bfa" />
      <circle cx="74" cy="30" r="2.5" fill="#ffffff" opacity="0.7" />
    </svg>
  )
}
