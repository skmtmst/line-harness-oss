'use client'

import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { AccountStyle } from '@line-crm/shared'
import type { StyleExperienceScript } from './script-types'

/*
 * 1 つのタイマーが「今のスタイルと段」を持ち、3 つの画面は段を読むだけ（画面ごとにタイマーを持たない）。
 * 止める条件：［止める］・器が見えない・タブが裏・動きを減らす設定。外れたら同じ段の頭から数え直す。
 * 部品を外す時（窓を閉じる等）は effect の片付けでタイマーを残さない。
 */

export type AutoplayPosition = { style: AccountStyle; index: number }

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(media.matches)
    change()
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return reduced
}

/** 器が少しでも見えているか。IntersectionObserver が無い所は見えている扱い。 */
function useInView(ref: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) setInView(entry.isIntersecting && entry.intersectionRatio > 0)
    }, { threshold: [0, 0.01] })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return inView
}

function useTabVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  return visible
}

export function useStyleExperienceAutoplay({ script, style, onStyleChange, rotation, repeatStyle, rootRef }: {
  script: StyleExperienceScript
  /** 外から渡すと外が持つ。 */
  style?: AccountStyle
  onStyleChange?: (style: AccountStyle) => void
  /** 最後の段の後に進むスタイルの順。 */
  rotation: AccountStyle[]
  /** 同じスタイルをくり返す（切り替えを外が持つ時）。 */
  repeatStyle: boolean
  rootRef: RefObject<HTMLElement | null>
}) {
  const reduced = useReducedMotion()
  const inView = useInView(rootRef)
  const tabVisible = useTabVisible()
  const lastIndex = (name: AccountStyle) => script.styles[name].scenes.length - 1
  const startIndex = (name: AccountStyle) => (reduced ? lastIndex(name) : 0)
  const [position, setPosition] = useState<AutoplayPosition>(() => {
    const first = style ?? rotation[0] ?? script.order[0]
    return { style: first, index: prefersReducedMotion() ? script.styles[first].scenes.length - 1 : 0 }
  })
  const [userPaused, setUserPaused] = useState(false)
  /** 同じスタイルの札をもう一度押した時に数え直すための印。 */
  const [restart, setRestart] = useState(0)

  // 外が持つスタイルが変わったら、そのスタイルの①（動きを減らす設定では最後の段）へ。
  if (style !== undefined && style !== position.style) setPosition({ style, index: startIndex(style) })
  // 動きを減らす設定になったら、今のスタイルの最後の段で止める（その後は Steps を押した時だけ移る）。
  const [reducedSeen, setReducedSeen] = useState(reduced)
  if (reduced !== reducedSeen) {
    setReducedSeen(reduced)
    if (reduced) setPosition({ style: position.style, index: lastIndex(position.style) })
  }

  const running = !userPaused && inView && tabVisible && !reduced
  const scene = script.styles[position.style].scenes[position.index]

  useEffect(() => {
    if (!running || !scene) return
    const timer = window.setTimeout(() => {
      if (position.index < lastIndex(position.style)) {
        setPosition({ style: position.style, index: position.index + 1 })
        return
      }
      if (repeatStyle) {
        setPosition({ style: position.style, index: 0 })
        return
      }
      const at = rotation.indexOf(position.style)
      const next = rotation[(at + 1) % rotation.length] ?? position.style
      setPosition({ style: next, index: 0 })
      if (next !== position.style) onStyleChange?.(next)
    }, scene.ms)
    return () => window.clearTimeout(timer)
    // 段・スタイル・止める条件・押した印が変わった時だけ数え直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, position.style, position.index, restart, repeatStyle])

  // 押せる段は今の段と違うので、段が変わったことでタイマーが数え直す。
  const goToStep = useCallback((index: number) => {
    setPosition((current) => ({ style: current.style, index }))
  }, [])

  const selectStyle = useCallback((next: AccountStyle) => {
    setPosition({ style: next, index: prefersReducedMotion() ? script.styles[next].scenes.length - 1 : 0 })
    setRestart((value) => value + 1)
    onStyleChange?.(next)
  }, [onStyleChange, script])

  return { position, scene, running, reduced, userPaused, togglePause: () => setUserPaused((value) => !value), goToStep, selectStyle }
}
