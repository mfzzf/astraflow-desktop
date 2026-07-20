import { useMemo, useRef } from 'react'
import { motion, useAnimate, type Transition } from 'framer-motion'

interface LetterSwapProps {
  /** 要渲染的文本；空格不参与交换动画 */
  label: string
  /** 样式类，字体/字号/颜色/斜体等从这里或父级继承 */
  className?: string
  /** 每个字母之间的错峰间隔（秒） */
  staggerDuration?: number
  /** 交换过渡 */
  ease?: Transition
  /** true=从下往上；false=从上往下 */
  reverse?: boolean
}

/**
 * 悬停时每个字母以随机顺序上下翻转交换的文本。字体、字号、颜色、斜体均继承父级，
 * 因此可直接内联在标题里。可见字母 aria-hidden，完整文本由 sr-only span 提供给读屏。
 * 改编自 Originkit Random Letter Swap。
 */
export default function LetterSwap({
  label,
  className,
  staggerDuration = 0.05,
  ease,
  reverse = false,
}: LetterSwapProps) {
  const [scope, animate] = useAnimate()
  const blockedRef = useRef(false)
  const transition = useMemo<Transition>(
    () => ease ?? { type: 'spring', duration: 0.7 },
    [ease],
  )

  const runForward = () => {
    if (blockedRef.current) return
    const idxs: number[] = []
    for (let k = 0; k < label.length; k++) {
      if (label[k] !== ' ') idxs.push(k)
    }
    if (idxs.length === 0) return
    blockedRef.current = true
    const order = [...idxs].sort(() => Math.random() - 0.5)
    order.forEach((idx, i) => {
      const isLast = i === order.length - 1
      const delayed: Transition = { ...transition, delay: i * staggerDuration }
      animate(`.ls-${idx}`, { y: reverse ? '100%' : '-100%' }, delayed).then(() => {
        animate(`.ls-${idx}`, { y: 0 }, { duration: 0 })
      })
      animate(`.ls2-${idx}`, { top: '0%' }, delayed).then(() => {
        animate(
          `.ls2-${idx}`,
          { top: reverse ? '-100%' : '100%' },
          { duration: 0 },
        ).then(() => {
          if (isLast) blockedRef.current = false
        })
      })
    })
  }

  const letters = label.split('')
  const restingTop = reverse ? '-100%' : '100%'

  return (
    <span
      ref={scope}
      onMouseEnter={runForward}
      className={className}
      style={{
        display: 'inline-flex',
        position: 'relative',
        overflow: 'hidden',
        verticalAlign: 'bottom',
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {label}
      </span>
      {letters.map((letter, i) => (
        <span
          key={i}
          aria-hidden
          style={{ whiteSpace: 'pre', position: 'relative', display: 'flex' }}
        >
          <motion.span
            className={`ls-${i}`}
            style={{ position: 'relative', top: 0, paddingRight: '0.06em' }}
          >
            {letter}
          </motion.span>
          <motion.span
            className={`ls2-${i}`}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: restingTop,
              paddingRight: '0.06em',
            }}
          >
            {letter}
          </motion.span>
        </span>
      ))}
    </span>
  )
}
