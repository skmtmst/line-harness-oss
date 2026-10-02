/*
 * ★V8 移行④b「一覧まわりを V8 に」の固定。
 *
 *   - 板の頭・表（見出し・行）・道具の1段・ページ送り・数の帯・
 *     選ぶカード が `[data-theme="v8"]` の下で V8 の寸法・色に切り替わる
 *   - 「経路の札」「進みの棒」は V8 と値が同じ（または v8対応済みの
 *     状態の札に委譲）なので、台帳に v8Same の印を付けて数える
 *   - v7 の見た目は変えない（全部 v8 セレクタの下）
 *
 * 値の出どころは Pencil ★V8 と lh-work/design/v8/COMPONENT-MAP.md の
 * オーナー決まり（表の寸法・数の帯の大きさ・箱の中に箱を作らない）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectReport } from '../../scripts/theme-migration-report.mjs'

const WEB = join(__dirname, '..', '..')
const SHARED = join(WEB, 'src/components/shared')
const globals = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8')
const css = (name: string) => readFileSync(join(SHARED, name), 'utf8')
const tsx = (name: string) => readFileSync(join(SHARED, name), 'utf8')

/** ある部品ファイルの v8 ブロック（全部まとめた文字列）を返す。 */
function v8Blocks(source: string, file: string) {
  const blocks = [...source.matchAll(/\[data-theme=["']?v8["']?\][^{]*\{([^}]*)\}/g)]
  expect(blocks.length, `${file} に [data-theme="v8"] の規定が無い`).toBeGreaterThan(0)
  return blocks.map((b) => b[1]).join('\n')
}

describe('V8 移行④b — 一覧まわり', () => {
  it('板の頭：題は 20px（text-title）・説明は 13px ink-secondary', () => {
    const blocks = v8Blocks(css('page-header.module.css'), 'page-header')
    expect(blocks).toContain('font-size: var(--text-title)')
    expect(blocks).toContain('font-size: var(--text-label)')
    expect(blocks).toContain('color: var(--color-ink-secondary)')
  })

  it('表の見出し：高さ44・地 table-head・上下に細い線・文字12/500', () => {
    const blocks = v8Blocks(css('table.module.css'), 'table')
    expect(blocks).toContain('height: 44px')
    expect(blocks).toContain('background: var(--color-table-head)')
    expect(blocks).toContain('border-top: 1px solid var(--color-divider)')
    expect(blocks).toContain('font-weight: 500')
  })

  it('表の行と外枠：行 52・左右20・区切りは divider・カード枠をやめる', () => {
    const blocks = v8Blocks(css('data-table.module.css'), 'data-table')
    expect(blocks).toContain('height: 52px')
    expect(blocks).toContain('padding: 9px 20px')
    expect(blocks).toContain('border-top: 1px solid var(--color-divider)')
    expect(blocks).toContain('border: 0')
    // 名前は 13px/500、補足は 12px ink-faint
    expect(blocks).toContain('font-size: var(--text-label)')
    expect(blocks).toContain('font-size: var(--text-caption)')
  })

  it('道具の1段：1段の帯・余白14/24・道具の間は 8', () => {
    const blocks = v8Blocks(css('list-toolbar.module.css'), 'list-toolbar')
    expect(blocks).toContain('gap: 8px')
    expect(blocks).toContain('padding: 14px 24px')
  })

  it('ページ送り：余白10/20・間6・ボタンは 32×32', () => {
    const blocks = v8Blocks(css('pagination.module.css'), 'pagination')
    expect(blocks).toContain('padding: 10px 20px')
    expect(blocks).toContain('gap: 6px')
    expect(blocks).toContain('height: 32px')
    expect(blocks).toContain('width: 32px')
  })

  it('数の帯：4枚のカードではなく1本の帯を縦線で割る（data-kpi-strip）', () => {
    expect(tsx('list-kpis.tsx')).toContain('kpiStyles.strip')
    const blocks = v8Blocks(css('kpi-card.module.css'), 'kpi-card')
    expect(blocks).toContain('border-left: 1px solid var(--color-divider)')
    expect(blocks).toContain('border-radius: 0')
    expect(blocks).toContain('box-shadow: none')
  })

  it('選ぶカード：余白 14・選ぶと枠 1.5px の濃い緑', () => {
    const blocks = v8Blocks(css('radio-card.module.css'), 'radio-card')
    expect(blocks).toContain('padding: 14px')
    expect(blocks).toContain('border-width: 1.5px')
    expect(blocks).toContain('border-color: var(--color-accent-deep)')
  })

  it('ダイアログ：大きさは 800/560・余白24・下から8px浮き出して入る', () => {
    const blocks = v8Blocks(css('dialog.module.css'), 'dialog')
    expect(blocks).toContain('width: min(800px, 100%)')
    expect(blocks).toContain('width: min(560px, 100%)')
    expect(blocks).toContain('padding: 24px')
    expect(css('dialog.module.css')).toContain('@keyframes dialog-v8-enter')
    expect(blocks).toContain('var(--motion-base)')
  })

  it('知らせ：下から 8px 浮き出しながら入る（200ms ease-out）', () => {
    const blocks = v8Blocks(css('toast.module.css'), 'toast')
    expect(blocks).toContain('animation: toast-v8-enter var(--motion-base) var(--motion-ease-out)')
    expect(css('toast.module.css')).toContain('@keyframes toast-v8-enter')
  })

  it('骨格の行：v8 では光が左から右へ流れる（globals の data-skeleton 規定）', () => {
    expect(globals).toContain('[data-theme="v8"] [data-skeleton]')
    expect(globals).toContain('@keyframes v8-skeleton-shimmer')
    expect(globals).toContain('1200ms')
  })

  it('？・ふきだし：v8 では吹き出しが黒い地に白い字（Pencil `f6zwfs`）', () => {
    const blocks = v8Blocks(css('help-tip.module.css'), 'help-tip')
    expect(blocks).toContain('background: var(--color-ink)')
    expect(blocks).toContain('color: var(--color-canvas)')
  })

  it('手順：v8 では白い板の中に枠付きカードを重ねない（globals 規定）', () => {
    expect(tsx('stepper.tsx')).toContain('data-part="stepper"')
    expect(globals).toContain('[data-theme="v8"] [data-part="stepper"]')
  })

  it('空の表示：v8 では真珠地のカードを重ねず平らにする', () => {
    const blocks = v8Blocks(css('list-state.module.css'), 'list-state')
    expect(blocks).toContain('background: transparent')
  })

  it('LINE の見え方：v8 では板の決まり（細い枠・radius-panel・board の影）にそろえる', () => {
    expect(tsx('line-preview.tsx')).toContain('styles.frame')
    const blocks = v8Blocks(css('line-preview.module.css'), 'line-preview')
    expect(blocks).toContain('border: 1px solid var(--color-board-line)')
    expect(blocks).toContain('border-radius: var(--radius-panel)')
  })

  it('台帳がこの回の部品を v8対応済みと数える', { timeout: 60_000 }, () => {
    const report = collectReport()
    const done = ['板の頭', '表（見出し・行・横に送れる表）', '道具の1段', 'ページ送り', '数のマス・数の帯', '選ぶカード', '経路の札', '進みの棒', 'ダイアログ', '知らせ', '骨格の行', '顔', '？・ふきだし', '帯／案内', '手順', '空の表示', 'LINE の見え方']
    for (const name of done) {
      const part = report.parts.find((p) => p.name === name)
      expect(part?.status, `${name} が v8対応済みになっていない`).toBe('v8対応済み')
    }
  })
})

describe('V8 移行④c — V8 で新たに生えた部品', () => {
  it('OTP入力：success 状態があり、v8 では緑の輪郭の規定を持つ', () => {
    expect(tsx('otp-input.tsx')).toContain('success')
    const blocks = v8Blocks(css('otp-input.module.css'), 'otp-input')
    expect(blocks).toContain('var(--color-accent-deep)')
  })

  it('削除ボタン：タイル → 確認の帯（✓/×）。Esc でやめられる', () => {
    const src = tsx('delete-button.tsx')
    expect(src).toContain('onConfirm')
    expect(src).toContain("event.key === 'Escape'")
    expect(css('delete-button.module.css')).toContain('.confirm')
    expect(css('delete-button.module.css')).toContain('var(--color-status-danger)')
  })

  it('色を選ぶ：macOS カラーウェル（見本＋格子＋十六進の欄）', () => {
    const src = tsx('color-well.tsx')
    expect(src).toContain('role="listbox"')
    expect(src).toContain('EyeDropper')
    const sheet = css('color-well.module.css')
    expect(sheet).toContain('grid-template-columns: repeat(8, 1fr)')
    expect(sheet).toContain('@keyframes color-well-pop')
  })

  it('台帳が新部品3件を v8対応済み（v8Only）と数える', { timeout: 60_000 }, () => {
    const report = collectReport()
    for (const name of ['OTP入力', '削除ボタン', '色を選ぶ']) {
      const part = report.parts.find((p) => p.name === name)
      expect(part?.status, `${name} が v8対応済みになっていない`).toBe('v8対応済み')
    }
  })
})

/*
 * ★V8 移行③仕上げ — 注目の星（オーナー決定 2026-10-01）。
 * オフは灰の線のまま、オンで黄色い塗り＋濃い黄の縁。
 */
describe('V8 移行 — 注目の星（選ぶと黄色）', () => {
  const friendRow = readFileSync(join(WEB, 'src/components/friends/friend-list-row.tsx'), 'utf8')

  it('v8 では選ぶと黄色い塗り＋濃い黄の縁（globals の data-part 規定）', () => {
    const rule = globals.match(/\[data-theme="v8"\] \[data-part="attention-star"\]\[aria-pressed="true"\] svg \{([^}]*)\}/)
    expect(rule, 'globals に注目の星の v8 規定が無い').not.toBeNull()
    expect(rule![1]).toContain('fill: var(--color-star-on)')
    expect(rule![1]).toContain('stroke: var(--color-star-on-edge)')
  })

  it('使う側（友だち一覧の行・カードの両方）が共通部品 AttentionStar を使い、部品に data-part="attention-star" が付く', () => {
    expect(friendRow.match(/<AttentionStar/g)?.length).toBe(2)
    const star = readFileSync(join(WEB, 'src/components/shared/attention-star.tsx'), 'utf8')
    expect(star).toContain('data-part="attention-star"')
  })

  it('オンになった瞬間、星がふくらんで戻る（動きを減らす設定では止まる）', () => {
    expect(globals).toContain('@keyframes v8-star-pop')
    expect(globals).toMatch(/prefers-reduced-motion: no-preference[\s\S]*?v8-star-pop/)
  })
})
