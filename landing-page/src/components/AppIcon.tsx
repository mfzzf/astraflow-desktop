import { assetUrl } from '@/lib/assets'

interface AppIconProps {
  className?: string
}

/** Use the packaged app artwork from the repository-wide public directory. */
export default function AppIcon({ className = 'h-24 w-24' }: AppIconProps) {
  return (
    <img
      src={assetUrl('icon/icon.png')}
      alt="AstraFlow"
      className={className}
      width="1024"
      height="1024"
    />
  )
}
