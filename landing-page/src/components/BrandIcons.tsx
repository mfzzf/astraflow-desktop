interface IconProps {
  className?: string
}

export function AppleLogo({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 384 512" className={className} fill="currentColor" aria-hidden>
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  )
}

export function WindowsLogo({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M3 5.5 10.6 4.4v7.1H3V5.5Zm8.6-1.2L21 3v8.5h-9.4V4.3ZM3 12.5h7.6v7.1L3 18.5v-6Zm8.6 0H21V21l-9.4-1.3v-7.2Z" />
    </svg>
  )
}

export function LinuxLogo({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <ellipse cx="12" cy="12.25" rx="6.2" ry="8.4" fill="currentColor" />
      <ellipse cx="12" cy="14.25" rx="4.15" ry="5.55" fill="white" />
      <circle cx="9.8" cy="7.4" r="1.65" fill="white" />
      <circle cx="14.2" cy="7.4" r="1.65" fill="white" />
      <circle cx="10.25" cy="7.55" r="0.62" fill="currentColor" />
      <circle cx="13.75" cy="7.55" r="0.62" fill="currentColor" />
      <path d="m12 8.35 2.15 1.45L12 11.1 9.85 9.8 12 8.35Z" fill="#f5a623" />
      <ellipse cx="7.25" cy="20.1" rx="3.25" ry="1.45" fill="#f5a623" />
      <ellipse cx="16.75" cy="20.1" rx="3.25" ry="1.45" fill="#f5a623" />
    </svg>
  )
}
