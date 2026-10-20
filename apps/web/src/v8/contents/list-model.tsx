'use client'
import { PAGE_SIZE_SELECT_OPTIONS } from '@/components/shared/page-size-select'

import type { MediaItem } from '@line-crm/shared'
import { formatMediaSize } from './media-usage-display'


/*
 * ★V8 登録メディア一覧（Pencil ）。
 *
 * 型（ListPage）に、数の帯（登録メディア・どこでも使っていない・使っている容量・アーカイブ）、
 * 左のフォルダの列（上に「メディアを登録する」）、案内の帯と道具の段、札の格子、表の下の範囲とページ送り、
 * 選んだときの一括バーをはめる。データの口・確かめの窓は今の V8（src/app/contents/list-v8.tsx）から写した。
 * 札の名前の前にフォルダの色の丸（2026-10-07 オーナー）。札の操作は「…」へ集める。
 */
export type MediaSort = 'newest' | 'oldest' | 'name' | 'size' | 'usage'

export const UNGROUPED = '__ungrouped__'

export const SORT_OPTIONS: Array<{ value: MediaSort; label: string }> = [
  { value: 'newest', label: '入れた日が新しい順' },
  { value: 'oldest', label: '入れた日が古い順' },
  { value: 'name', label: 'ファイル名順' },
  { value: 'size', label: '容量が大きい順' },
  { value: 'usage', label: '使われている順' },
]

export const PAGE_SIZE_OPTIONS = PAGE_SIZE_SELECT_OPTIONS

/**
 * 絞り込みの種別。保存できる kind は image / video / audio / file の4つ。
 * file はいま PDF だけなので、そのまま「PDF」と呼ぶ。
 */
export const KINDS: Array<{ key: MediaItem['kind']; label: string }> = [
  { key: 'image', label: '画像' },
  { key: 'audio', label: '音声' },
  { key: 'video', label: '動画' },
  { key: 'file', label: 'PDF' },
]

export function formatMediaDetails(item: MediaItem): string {
  const format = item.mimeType.split('/').at(-1)?.replace('jpeg', 'jpg').toUpperCase() ?? ''
  const details = [format]
  if (item.width != null && item.height != null) {
    details.push(`${item.width}×${item.height}`)
  } else if (item.durationMs != null) {
    details.push(`${Math.round(item.durationMs / 1000)}秒`)
  }
  details.push(formatMediaSize(item.sizeBytes))
  return details.filter(Boolean).join(' ／ ')
}

/** 使用先を取得でき、かつ0件と確定したメディアだけを削除候補にする。 */
export function isKnownUnused(item: MediaItem): boolean {
  return item.usageCount === 0
}

/** 格子と一覧。**中身は同じ。並べ方だけを切り替える。** */
export type MediaView = 'grid' | 'list'

export type MediaManagementPermission = 'loading' | 'allowed' | 'denied' | 'error'

export type MediaDetailPhase = 'idle' | 'loading' | 'ready' | 'unavailable'

export type MediaDetailFailure = 'missing' | 'denied' | 'retryable'

export function mediaDetailIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  const id = new URLSearchParams(window.location.search).get('id')?.trim()
  return id || null
}

/** 数の帯の4マス。失敗・未取得は null（「—」表示）にする。 */
export type MediaKpis = {
  known: boolean
  total: number | null
  kindTotals: Record<MediaItem['kind'], number | null>
  unusedTotal: number | null
  archivedTotal: number | null
}
