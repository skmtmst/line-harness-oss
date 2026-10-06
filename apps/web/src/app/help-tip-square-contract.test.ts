/*
 * 「？」は正円に1本化する（★V7 `LYs5d`・2026-09-28 オーナー指示）。
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
  it('箱は 18×18 に固定し、縦横を同じに保つ', () => {
    // 行頭に固定する（`min-width: 18px;` の中に `width: 18px;` が
    // 含まれるため、toContain では戻しても赤くならない）。
    for (const declaration of [
      'width: 18px;',
      'height: 18px;',
      'min-width: 18px;',
      'max-width: 18px;',
      'max-height: 18px;',
      'aspect-ratio: 1 / 1;',
    ]) {
      expect(CSS).toMatch(new RegExp(`^\\s*${declaration.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'm'))
    }
    // globals の min-height:32px を上書きし、題の行を伸ばさない。
    expect(CSS).toMatch(/^\s*min-height: 0;/m)
  })

  it('箱は枠つき（ink-faint・canvas）で、中の「?」は 11px 太字 ink-secondary', () => {
    expect(CSS).toContain('border: 1px solid var(--color-ink-faint);')
    expect(CSS).toContain('background: var(--color-canvas);')
    expect(CSS).toContain('border-radius: var(--radius-pill);')
    expect(CSS).toContain('font-size: var(--text-micro);')
    expect(CSS).toContain('font-weight: 500;')
  })

  it('lucide の丸いアイコン・枠なし・透明地は使わない', () => {
    expect(TSX).not.toContain('lucide')
    expect(TSX).not.toContain('CircleHelp')
    expect(TSX).toContain('className={styles.mark}>?</span>')
    expect(CSS).not.toContain('.button svg')
    expect(CSS.match(/\.button\s*\{[^}]*\}/)?.[0]).not.toContain('background: transparent;')
    const baseButton = CSS.match(/^\.button\s*\{[^}]*\}/m)?.[0]
    expect(baseButton).toBeDefined()
    expect(baseButton).not.toMatch(/border:\s*0;/)
  })

  it('カードの見出しは題と「？」をひとかたまりで縦の中央にそろえる', () => {
    expect(SIDE_CARDS).toContain('題と「？」・期間はひとかたまり')
    expect(SIDE_CARDS).toContain('items-center gap-1')
    expect(PAGE).toContain('題と「？」・期間はひとかたまり')
  })
})

describe('V8の「？」は円と押せる範囲を分ける', () => {
  it('16pxの円を28pxの当たりの中に置き、枠と背景は円が持つ', () => {
    const button = CSS.match(/\[data-theme='v8'\] \.button\s*\{[^}]*\}/)?.[0]
    const mark = CSS.match(/\[data-theme='v8'\] \.mark\s*\{[^}]*\}/)?.[0]
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
  it('「？」は見出しの日付の横に1つだけ置く', () => {
    expect(TREND.match(/<HelpTip/g)?.length).toBe(1)
    expect(TREND).toContain('日付の推定値の説明')
    expect(TREND).not.toContain('EstimatedHelp')
  })

  it('流入元の列と「すべて表示」は置かない', () => {
    // 見出しセル（<th>…</th>）として出さない。設計メモの言及は許す。
    expect(TREND).not.toMatch(/<th[\s\S]*?流入元の内訳/)
    expect(TREND).not.toContain('すべて表示')
    expect(TREND).not.toContain('formatTrendSources')
  })
})
