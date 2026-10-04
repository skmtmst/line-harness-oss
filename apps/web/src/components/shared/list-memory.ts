'use client'

import { useEffect, useState } from 'react'

export type ListFilters = Record<string, string>

export type ListMemory = {
  filters: ListFilters
  scrollY: number
}

function isV8(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'v8'
}

function storageKey(key: string): string {
  return `lh:list-memory:${key}`
}

/** タブの中の記憶を読む（タブを閉じたら消える sessionStorage）。 */
export function loadListMemory(key: string): ListMemory | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ListMemory>
    if (typeof parsed !== 'object' || parsed === null) return null
    return {
      filters: typeof parsed.filters === 'object' && parsed.filters !== null ? (parsed.filters as ListFilters) : {},
      scrollY: typeof parsed.scrollY === 'number' ? parsed.scrollY : 0,
    }
  } catch {
    return null
  }
}

/** タブの中の記憶へ書く。壊れた値は捨てる（戻ったときに前の画面が出ない事故を防ぐ）。 */
export function saveListMemory(key: string, memory: ListMemory): void {
  try {
    window.sessionStorage.setItem(storageKey(key), JSON.stringify(memory))
  } catch {
    // 容量切れなど。覚えられないだけで一覧は動く。
  }
}

/**
 * ③ よく使う一覧の絞り込みとスクロール位置の記憶（V8「サクサク感」F）。
 * 戻ったときに、直前の絞り込みと位置へ戻す。そのタブの間だけ覚える。
 * 画面側は `const [filters, setFilters] = useListMemory('broadcasts', { status: 'all' })`
 * と書くだけ（付け替えは各画面の持ち主がやる）。
 */
export function useListMemory(key: string, initial: ListFilters): [ListFilters, (next: ListFilters) => void] {
  const [filters, setFilters] = useState<ListFilters>(() => {
    if (!isV8()) return initial
    return loadListMemory(key)?.filters ?? initial
  })

  // 戻ってきたら位置へ戻す（描いた直後に1回）。
  useEffect(() => {
    if (!isV8()) return
    const saved = loadListMemory(key)?.scrollY ?? 0
    if (saved <= 0) return
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, saved))
    return () => window.cancelAnimationFrame(frame)
  }, [key])

  // 絞り込みが変わったら覚える。離れるときは位置も一緒に覚える。
  useEffect(() => {
    if (!isV8()) return
    saveListMemory(key, { filters, scrollY: loadListMemory(key)?.scrollY ?? 0 })
  }, [key, filters])
  useEffect(() => {
    if (!isV8()) return
    const onScroll = () => {
      saveListMemory(key, { filters: loadListMemory(key)?.filters ?? {}, scrollY: window.scrollY })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      saveListMemory(key, { filters: loadListMemory(key)?.filters ?? {}, scrollY: window.scrollY })
    }
  }, [key])

  return [filters, setFilters]
}
