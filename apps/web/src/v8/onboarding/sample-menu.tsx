'use client'

import type { CSSProperties } from 'react'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import type { AccountStyle } from '@line-crm/shared'
import { SetupIcon } from './icons'
import { sampleMenuFor } from './model'
import styles from './sample-menu.module.css'
import type { StarterButton } from './use-starter-menu'

/*
 * 見本のリッチメニュー（★V8 修正案 wI4ZX・RZW83 の「入る見本」・cAaGY の「お客さまの見え方」）。
 * 3 列 × 2 段のボタン。色は見本の画像の色（スタイルごとのデータ）。
 */

export function SampleMenuTiles({ style, buttons, selected, warned = [], onSelect, size = 'panel', label }: {
  style: AccountStyle
  buttons?: StarterButton[]
  /** 選んでいるボタン（お客さまの見え方で、押したときを出しているボタン）。 */
  selected?: number | null
  /** 中身が未設定の機能（feature）。押せる見本で、選んだ形の枠を出す。 */
  warned?: string[]
  onSelect?: (index: number) => void
  size?: 'panel' | 'preview' | 'phone'
  label?: string
}) {
  const menu = sampleMenuFor(style)
  const tiles = buttons ? buttons.map(button => ({ ...button, icon: menu.tiles.find(tile => tile.feature === button.feature)?.icon ?? 'file' })) : menu.tiles
  const tone = { '--sample-bg': menu.tone.bg, '--sample-ink': menu.tone.ink } as CSSProperties
  return (
    <div className={styles.grid} data-size={size} style={tone} role={onSelect ? 'group' : undefined} aria-label={label ?? '見本のリッチメニュー'}>
      {tiles.map((tile, index) => {
        const body = <><SetupIcon name={tile.icon} className={styles.icon} /><span className={styles.label}>{tile.label}</span></>
        return onSelect ? (
          <button key={tile.label} type="button" className={styles.tile} data-selected={selected === index || undefined} data-warned={warned.includes(tile.feature) || undefined} onClick={() => onSelect(index)}>{body}</button>
        ) : (
          <span key={tile.label} className={styles.tile} data-selected={selected === index || undefined}>{body}</span>
        )
      })}
    </div>
  )
}

/** スマホの中の見本（wI4ZX の 1 台）。トークに友だち追加のあいさつ、下にリッチメニュー。 */
export function SampleMenuPhone({ style }: { style: AccountStyle }) {
  const menu = sampleMenuFor(style)
  return (
    <LinePreview title={null} accountName={menu.account} richMenu={<SampleMenuTiles style={style} size="phone" />}>
      <LinePreviewMessage accountName={menu.account} avatar={<span className={styles.avatar}>然</span>} time="10:00">{menu.greeting}</LinePreviewMessage>
    </LinePreview>
  )
}
