import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

/*
 * R283: 縦に長い編集の窓では、見出しと閉じるボタンが画面上へ隠れた。
 *
 * 面（1102px）が画面（900px）をはみ出し、外側のスクロールは既に
 * 上端で、閉じるボタンへ戻れなかった。直しは共通 Dialog で全画面に
 * 効かせる：面の高さを画面内に収め、見出し行と操作を縮めずに残し、
 * 中身だけを中で送る（右詳細パネル drawer と同じ形）。
 */
describe('R283 縦に長い窓でも見出しと閉じる操作に到達できる', () => {
  it('面の高さを画面内に収め、中身だけを中で送る', () => {
    const css = read('dialog.module.css')
    expect(css).toMatch(/\.panel \{[^}]*max-height: calc\(100dvh - 32px\);[^}]*\}/s)
    expect(css).toMatch(/\.content \{[^}]*overflow-y: auto;[^}]*\}/s)
    expect(css).toMatch(/\.content \{[^}]*min-height: 0;[^}]*\}/s)
  })

  it('見出し行と操作は縮めずに残す', () => {
    const css = read('dialog.module.css')
    expect(css).toMatch(/\.headerRow \{[^}]*flex: 0 0 auto;[^}]*\}/s)
    expect(css).toMatch(/\.actions \{[^}]*flex: 0 0 auto;[^}]*\}/s)
  })

  it('見出し・閉じる→中身→操作の順に並ぶ', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open
        modal={false}
        title="「購入」を編集"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        confirmLabel="この内容にする"
      >
        <p>長い入力欄の代わり</p>
      </Dialog>,
    )
    const titleAt = html.indexOf('「購入」を編集')
    const closeAt = html.indexOf('aria-label="閉じる"')
    const bodyAt = html.indexOf('長い入力欄の代わり')
    const actionAt = html.indexOf('この内容にする')
    expect(titleAt).toBeGreaterThanOrEqual(0)
    expect(closeAt).toBeGreaterThanOrEqual(0)
    expect(bodyAt).toBeGreaterThan(closeAt)
    expect(actionAt).toBeGreaterThan(bodyAt)
  })
})
