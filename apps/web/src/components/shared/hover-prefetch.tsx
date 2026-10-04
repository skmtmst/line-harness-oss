'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

const INTENT_MS = 120 // 乗せた速さ（--motion-fast）に合わせ、少し置いてから読む

function isV8(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'v8'
}

/**
 * ① 左メニュー・一覧のリンクの先読み（V8「サクサク感」F）。
 * どの画面にも置かず、ここを外枠に1つ置くだけで、同じタブ内の
 * 行き先リンクにマウスが乗ったら次の画面を先に読む。
 * 行き先ごとの API の温めは、リンク側が `data-prefetch="/api/xxx"`
 * と書いた分だけ足す（書かなければ画面の読み込みだけ）。
 */
export default function HoverPrefetch() {
  const router = useRouter()
  const warmedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let timer: number | undefined
    let target: HTMLAnchorElement | null = null
    const closestAnchor = (node: EventTarget | null): HTMLAnchorElement | null =>
      node instanceof HTMLElement ? (node.closest('a[href]') as HTMLAnchorElement | null) : null

    const warm = (anchor: HTMLAnchorElement) => {
      let url: URL
      try {
        url = new URL(anchor.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      const key = `${url.pathname}${url.search}`
      if (!anchor.hasAttribute('data-prefetch') && warmedRef.current.has(key)) return
      warmedRef.current.add(key)
      // 画面の読み込み（RSC）。Link 以外の素の <a> にも効く。
      try {
        void router.prefetch(key)
      } catch {
        // 先読みの失敗は押したときの読み込みに任せる。
      }
      // 行き先のデータ（リンク側が指名した API だけ）。
      const extra = anchor.getAttribute('data-prefetch')
      if (!extra) return
      for (const path of extra.split(/\s+/).filter(Boolean)) {
        if (warmedRef.current.has(`data:${path}`)) continue
        warmedRef.current.add(`data:${path}`)
        fetch(path, { credentials: 'same-origin' }).catch(() => {})
      }
    }

    const onOver = (event: MouseEvent) => {
      if (!isV8()) return
      const anchor = closestAnchor(event.target)
      if (!anchor || anchor === target) return
      window.clearTimeout(timer)
      target = anchor
      timer = window.setTimeout(() => warm(anchor), INTENT_MS)
    }
    const onOut = (event: MouseEvent) => {
      const anchor = closestAnchor(event.target)
      if (anchor && anchor === target) {
        window.clearTimeout(timer)
        target = null
      }
    }
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
    }
  }, [router])

  return null
}
