/*
 * 「？」は正円に1本化する（★管理画面 `LYs5d`・2026-09-28 オーナー指示）。
 *
 * 18px の正円（枠 1px `ink-faint`・地 `canvas`）の中に「?」11px
 * 太字 `ink-secondary`。角丸の正方形・楕円・枠なしは使わない。表の中・
 * 札の横・カードの見出し、どこに置いても 18×18 の正円のまま
 * （globals の button の min-height・表の中の button の決まりに負けない）。
 * 見出しの行は `inline-flex items-center gap-1` で文字の縦の中央にそろえる。
 *
 * 幅・高さの実測は撮影（司令塔）で行う。ここでは宣言を文字で固定し、
 * 直しを戻すと赤くなることを見る。
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SHARED = path.join(__dirname, '..', 'components', 'shared')
const DASHBOARD = path.join(__dirname, '..', 'components', 'dashboard')
const CSS = fs.readFileSync(path.join(SHARED, 'help-tip.module.css'), 'utf8')
const TSX = fs.readFileSync(path.join(SHARED, 'help-tip.tsx'), 'utf8')
const SIDE_CARDS = fs.readFileSync(path.join(DASHBOARD, 'side-cards.tsx'), 'utf8')
const TREND = fs.readFileSync(path.join(DASHBOARD, 'friend-trend-table.tsx'), 'utf8')
const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('「？」の正円', () => {
  it('文字の「？」を専用の円に置き、アイコンへ置き換えない', () => {
    expect(TSX).not.toContain('lucide')
    expect(TSX).not.toContain('CircleHelp')
    expect(TSX).toContain('className={styles.mark}>?</span>')
    expect(CSS).not.toContain('.button svg')
    expect(CSS).toMatch(/:root \.button\s*\{[^}]*background:\s*transparent;/)
  })

  it('カードの見出しは題と「？」をひとかたまりで縦の中央にそろえる', () => {
    const head = fs.readFileSync(path.join(__dirname, '../v8/dashboard/head.tsx'), 'utf8')
    const shared = fs.readFileSync(path.join(SHARED, 'section-header.tsx'), 'utf8')
    expect(head).toContain('<SectionHeader wrap {...props}')
    expect(shared).toContain('<HelpTip')
    expect(shared).toContain('styles.title')
  })
})

describe('V8の「？」は円と押せる範囲を分ける', () => {
  it('16pxの円を28pxの当たりの中に置き、枠と背景は円が持つ', () => {
    const button = CSS.match(/:root \.button\s*\{[^}]*\}/)?.[0]
    const mark = CSS.match(/:root \.mark\s*\{[^}]*\}/)?.[0]
    expect(button).toContain('width: 28px;')
    expect(button).toContain('height: 28px;')
    expect(button).toContain('background: transparent;')
    expect(mark).toContain('width: 16px;')
    expect(mark).toContain('height: 16px;')
    expect(mark).toContain('border: 1.2px solid var(--color-ink-faint);')
    expect(mark).toContain('border-radius: var(--radius-pill);')
    expect(mark).toContain('background: var(--color-canvas);')
  })
})

describe('友だち数の推移の表の「？」', () => {
  it('行ごとの古い説明部品を復活させない', () => {
    expect(TREND).not.toContain('EstimatedHelp')
  })

  it('流入元の列と「すべて表示」は置かない', () => {
    // 見出しセル（<th>…</th>）として出さない。設計メモの言及は許す。
    expect(TREND).not.toMatch(/<th[\s\S]*?流入元の内訳/)
    expect(TREND).not.toContain('すべて表示')
    expect(TREND).not.toContain('formatTrendSources')
  })
})
