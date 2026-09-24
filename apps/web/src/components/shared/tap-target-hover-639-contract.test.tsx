import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import FilterChip from './filter-chip'
import Pagination from './pagination'
import { RowActions } from './row-actions'
import { Tabs } from './tabs'

/*
 * #639 タップ高さ・ホバーの契約。
 *
 * 監査5の指摘: ピル/フィルタ/補助リンクが 20〜32px でタップ推奨 44px を
 * 下回り、16画面で主要ボタンのホバー前後が不変だった。
 *
 * 規則（共通部品レベルで固定・段階適用の土台）:
 *   - 主要操作の最小高さは 32px、推奨 36px 以上は部品側で持つ
 *     （共通 Button 40px・ページネーション 38px・行内アイコン 32px・
 *     タブ 44px）。素のボタンはベースCSSの `min-height: 32px` で拾う。
 *   - タッチ端末（`pointer: coarse`）は 44px を確保する。
 *   - ホバー演出は `@media (hover: hover) and (pointer: fine)` の中に
 *     だけ書く（タップ後にホバーが残らないように）。
 *
 * 対象外の明示: スイッチ（`role="switch"`）は 20px の軌道とつまみの
 * 比率が決まっているため、高さだけ伸ばさない。ページネーションの
 * 表記統一は #667、フィルターバーの構成統一は #668 の範囲。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')
const readShared = (name: string) => readFileSync(join(HERE, name), 'utf8')
const readApp = (name: string) => readFileSync(join(SRC, 'app', name), 'utf8')
const GLOBALS = readShared('../../app/globals.css')
/** 注釈を落としたベースCSS。宣言だけを見る。 */
const GLOBALS_CODE = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('#639 主要操作の最小高さ 32px', () => {
  it('素のボタンはベース層で 32px を下回らない（高い部品はそのまま）', () => {
    expect(GLOBALS_CODE).toMatch(/button:not\(\[role="switch"\]\),\s*\[role="button"\]\s*\{\s*min-height:\s*32px;/)
  })

  it('行内ボタン・チップ・ページネーションは 32px 以上を部品側で持つ', () => {
    // 行内アイコン操作 32px（Pencil K65Uhe・Ls12y・H0V8EK の寸法）。
    expect(readShared('row-actions.module.css')).toMatch(/\.action\s*\{[^}]*height:\s*32px/s)
    // 一覧の絞り込み札 32px。
    expect(readShared('filter-chip.css')).toMatch(/\.v6-filter-chip\s*\{[^}]*height:\s*32px/s)
    // ページネーションは推奨 36px 以上（38px）。
    expect(readShared('pagination.module.css')).toMatch(/\.item\s*\{[^}]*height:\s*38px/s)
    // タブは 44px。
    expect(readShared('tabs.module.css')).toMatch(/\.tab\s*\{[^}]*height:\s*44px/s)
    // 共通ボタンの標準は 40px。
    expect(readShared('button.module.css')).toMatch(/\.standard\s*\{[^}]*height:\s*40px/s)
  })

  it('画像タイルのお気に入り星は 32px の当たりを持つ', () => {
    const tile = readFileSync(join(SRC, 'components', 'hq', 'banners', 'image-tile.tsx'), 'utf8')
    expect(tile).toMatch(/aria-label=\{image\.isFavorite \? 'お気に入りから外す' : 'お気に入りにする'\}[\s\S]*?h-8 w-8/)
  })
})

describe('#639 タッチ端末は 44px', () => {
  it('ベース層で素のボタンを 44px にする（スイッチは除く）', () => {
    expect(GLOBALS_CODE).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*button:not\(\[role="switch"\]\),\s*\[role="button"\]\s*\{\s*min-height:\s*44px;/,
    )
  })

  it('行内操作・チップ・ページネーション・汎用アイコンは部品側で 44px', () => {
    expect(readShared('row-actions.module.css')).toMatch(
      /@media \(pointer: coarse\)\s*\{[^}]*\.action\s*\{[^}]*height:\s*44px/s,
    )
    expect(readShared('filter-chip.css')).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.v6-filter-chip\s*\{\s*min-height:\s*44px;/,
    )
    expect(readShared('pagination.module.css')).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.item\s*\{\s*min-height:\s*44px;/,
    )
    expect(readShared('icon-button.module.css')).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.button\s*\{[^}]*height:\s*44px/s,
    )
  })
})

describe('#639 ホバーは hover:hover かつ pointer:fine の中にだけ書く', () => {
  it('素のボタンと文字リンクに代替の視覚反応がある', () => {
    expect(GLOBALS_CODE).toContain('@media (hover: hover) and (pointer: fine)')
    // 背景の無い素の文字ボタンだけが変わる。背景もホバーも持つ部品は
    // 層の順序でそちらが勝つ。
    expect(GLOBALS_CODE).toMatch(
      /button:not\(:disabled, \[role="switch"\]\):hover,[\s\S]*?background-color:\s*var\(--color-canvas-sunken\)/,
    )
    // 文字リンクは操作色で応答する（枠付きボタン状リンクに線を入れない）。
    expect(GLOBALS_CODE).toMatch(/a:hover\s*\{\s*color:\s*var\(--color-action-hover\);\s*\}/)
  })

  it('transition: all を使わない（#648の教訓）', () => {
    expect(GLOBALS_CODE).not.toMatch(/transition(?:-property)?\s*:\s*all\b/)
  })

  it('背景色付きの主要ボタンは自前のホバー変化を持つ', () => {
    // 予約メニュー・緊急時の確定口は濃色フィルに brightness で沈む。
    expect(readApp('booking/menus/staff/page.tsx')).toContain('bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium hover:brightness-90')
    expect(readApp('emergency/page.tsx')).toContain('min-h-9 bg-accent-deep px-3 text-xs font-bold text-on-accent hover:brightness-90')
    // 流入経路モーダル・プールは brightness で沈む（生の色を増やさない）。
    expect(readApp('inflow-links/_components/create-genre-modal.tsx')).toContain('bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-90')
    expect(readApp('inflow-links/_components/edit-route-modal.tsx')).toContain('bg-blue-600 text-white hover:brightness-90')
    expect(readApp('pools/page.tsx')).toContain('bg-blue-600 text-white hover:brightness-90')
    // 白地の枠付き口は沈み色へ、淡色ピルは brightness で応答する。
    expect(readApp('tags/folders/new/page.tsx')).toContain('bg-canvas text-ink-secondary border px-4 py-2.5 text-sm font-medium hover:bg-canvas-sunken')
    expect(readApp('booking/bookings/booking-calendar.tsx')).toContain('bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-deep hover:brightness-95')
  })
})

describe('#639 高さ規則は本物の操作部品に載る（実React描画）', () => {
  it('絞り込み札は押せるボタンとして描かれる', () => {
    const html = renderToStaticMarkup(
      <FilterChip selected={false} onChange={vi.fn()}>
        未対応
      </FilterChip>,
    )
    expect(html).toContain('<button')
    expect(html).toContain('v6-filter-chip')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('未対応')
  })

  it('ページ送りは nav の中に実ボタンを並べる', () => {
    const html = renderToStaticMarkup(<Pagination page={2} pageCount={5} onPageChange={vi.fn()} />)
    expect(html).toContain('<nav aria-label="ページ送り"')
    expect(html).toContain('aria-label="前のページ"')
    expect(html).toContain('aria-label="次のページ"')
    expect(html).toContain('aria-current="page"')
  })

  it('行内操作は「詳細」「編集」の実ボタンを出す', () => {
    const html = renderToStaticMarkup(
      <RowActions
        subjectName="来店お礼"
        detail={{ href: '/templates/detail?id=t1' }}
        edit={{ onClick: vi.fn() }}
      />,
    )
    expect(html).toContain('詳細')
    expect(html).toContain('編集')
    expect(html).toMatch(/<(button|a)\b/)
  })

  it('タブは行き先つきリンクと操作ボタンを描き分ける', () => {
    const html = renderToStaticMarkup(
      <Tabs
        items={[
          { label: 'すべて', href: '/friends', current: true },
          { label: '未対応', count: 3, onClick: vi.fn() },
        ]}
      />,
    )
    expect(html).toContain('<nav')
    expect(html).toContain('未対応')
    expect(html).toContain('<span')
    expect(html).toContain('3')
  })
})
