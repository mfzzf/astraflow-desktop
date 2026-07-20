import { useEffect, useRef, useState } from 'react'

type HeroVideoProps = {
  src: string
  poster: string
  className?: string
  /** 淡入淡出时长（秒），默认 0.5s */
  fade?: number
}

/**
 * 背景视频层：不使用原生 loop，而是用 requestAnimationFrame 手动驱动
 * 首尾各 0.5s 的透明度淡入淡出，配合 ended 后的短暂留白复位，
 * 得到没有硬切跳变的无缝循环。命中 prefers-reduced-motion 时只渲染静态首帧。
 */
export default function HeroVideo({
  src,
  poster,
  className,
  fade = 0.5,
}: HeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (reducedMotion) return
    const video = videoRef.current
    if (!video) return

    let raf = 0
    let resetTimer: ReturnType<typeof setTimeout> | undefined

    const tick = () => {
      const { currentTime: t, duration: d } = video
      if (Number.isFinite(d) && d > fade * 2) {
        let opacity = 1
        if (t < fade) opacity = t / fade
        else if (t > d - fade) opacity = Math.max(0, (d - t) / fade)
        video.style.opacity = String(opacity)
      }
      raf = requestAnimationFrame(tick)
    }

    const onEnded = () => {
      video.style.opacity = '0'
      resetTimer = setTimeout(() => {
        video.currentTime = 0
        void video.play().catch(() => {})
      }, 100)
    }

    video.addEventListener('ended', onEnded)
    void video.play().catch(() => {})
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      if (resetTimer) clearTimeout(resetTimer)
      video.removeEventListener('ended', onEnded)
    }
  }, [reducedMotion, fade])

  if (reducedMotion) {
    return (
      <img
        src={poster}
        alt=""
        aria-hidden
        className={className ?? 'h-full w-full object-cover'}
      />
    )
  }

  return (
    <video
      ref={videoRef}
      className={`hero-video ${className ?? 'h-full w-full object-cover'}`}
      poster={poster}
      muted
      playsInline
      autoPlay
      preload="auto"
      aria-hidden
      disablePictureInPicture
      style={{ opacity: 0 }}
    >
      <source src={src} type="video/mp4" />
    </video>
  )
}
