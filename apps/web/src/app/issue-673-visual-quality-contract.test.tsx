// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * #673 視覚品質基盤の契約。
 *
 * A. カードの影は `--shadow-card` / `--shadow-float` の層状影（Beautiful
 *    shadows）に統一し、画面個別の任意値 shadow を残さない。
 * B. 押した感触・行ホバー・メニューの出入り・指標カードの骨組みを、
 *    共通のベースCSSと主要な指標カードへ入れる。
 *
 * 文字列を読むだけの契約では、読み込み中に骨組みが本当に描画されるか
 * 見えないので、InboxKpis を実Reactで mount して確かめる。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')
const GLOBALS = readFileSync(join(HERE, 'globals.css'), 'utf8')
/** 注釈を落としたCSS。宣言だけを見る。 */
const GLOBALS_CODE = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, '')

vi.mock('@/lib/api', () => ({
  api: {
    chatStats: {
      get: vi.fn(),
    },
  },
}))

import { api } from '@/lib/api'
import InboxKpis from '@/components/chats/inbox-kpis'

const chatStatsGet = vi.mocked(api.chatStats.get)

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.clearAllMocks()
})

describe('#673 A. カード・パネルの立体感', () => {
  it('カードの影は層状影（近距離の薄い影＋下端の光＋1pxリング）', () => {
    const card = GLOBALS_CODE.match(/--shadow-card:\s*([^;]+);/)?.[1] ?? ''
    // 3層の影。輪郭の1pxリングが罫線の代わりになる。
    expect(card.split(',').length).toBeGreaterThanOrEqual(3)
    expect(card).toContain('0px 0px 0px 1px')
  })

  it('浮いて見える面の影はカードより一段強い層状影', () => {
    const float = GLOBALS_CODE.match(/--shadow-float:\s*([^;]+);/)?.[1] ?? ''
    expect(float.split(',').length).toBeGreaterThanOrEqual(3)
    expect(float).toContain('0px 0px 0px 1px')
  })

  it('モーダル・フォルダパネル・パネル内メニューは属性入口でトークンを読む', () => {
    // components/shared/ は変更できないため、globals.css の属性規定で上書きする。
    expect(GLOBALS_CODE).toMatch(/\[data-design-part="dialog"\]\[data-design-node\]\s*\{[^}]*var\(--shadow-float\)/)
    expect(GLOBALS_CODE).toMatch(/aside\[aria-label="フォルダ"\]\s*\{[^}]*var\(--shadow-card\)/)
    expect(GLOBALS_CODE).toMatch(/aside\[aria-label="フォルダ"\] \.shadow-lg\s*\{[^}]*var\(--shadow-float\)/)
  })

  it('主要画面の任意値 shadow をトークンへ寄せた', () => {
    const migrated = [
      ['components/chats/inbox-kpis.tsx', 'shadow-card'],
      ['components/chats/template-picker.tsx', 'shadow-card'],
      ['components/dashboard/qr-dialog.tsx', 'shadow-float'],
      ['components/dashboard/dashboard-editor.tsx', 'shadow-card'],
      ['app/chats/page.tsx', 'shadow-card'],
      ['app/duplicates/page.tsx', 'shadow-card'],
    ] as const
    for (const [file, token] of migrated) {
      const source = readFileSync(join(SRC, file), 'utf8')
      expect(source, `${file} にトークンが無い`).toContain(token)
      expect(source, `${file} に旧カード影が残っている`).not.toContain('shadow-[1px_1px_2px')
    }
    // ダッシュボード編集の引き出しは方向付きの直書きをやめ、浮く面の影へ。
    const editor = readFileSync(join(SRC, 'components/dashboard/dashboard-editor.tsx'), 'utf8')
    expect(editor).toContain('shadow-float')
  })
})

describe('#673 B. 触った感触', () => {
  it('ボタンは160msのease-outで scale(0.97) に沈む', () => {
    expect(GLOBALS_CODE).toMatch(/button:not\(:disabled\):active[\s\S]*?transform:\s*scale\(0\.97\)/)
    expect(GLOBALS_CODE).toMatch(/transform 160ms var\(--motion-ease-out\)/)
  })

  it('transition: all を使わない（#648の教訓）', () => {
    expect(GLOBALS_CODE).not.toMatch(/transition(?:-property)?\s*:\s*all\b/)
  })

  it('行のホバーは hover:hover かつ pointer:fine の環境に限定する', () => {
    expect(GLOBALS_CODE).toContain('@media (hover: hover) and (pointer: fine)')
    expect(GLOBALS_CODE).toMatch(/tbody tr:hover\s*\{[^}]*var\(--color-canvas-sunken\)/)
  })

  it('メニュー・モーダルの出入りは150〜250msの ease-out', () => {
    expect(GLOBALS_CODE).toMatch(/@keyframes lh-surface-in/)
    expect(GLOBALS_CODE).toMatch(/\[data-design-part="action-menu"\][\s\S]*?animation:\s*lh-surface-in var\(--motion-base\)/)
    expect(GLOBALS_CODE).toMatch(/\[data-design-part="dialog"\]\s*\{[^}]*animation:\s*lh-surface-in/)
  })

  it('動きを減らす設定で位置移動系が止まる', () => {
    const block = GLOBALS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(block).toContain('animation-duration: 0.01ms !important')
    expect(block).toContain('transition-duration: 0.01ms !important')
  })
})

describe('#673 指標カードのスケルトン', () => {
  it('読み込み中は数の場所に骨組みを出し、取れてから実数に替わる', async () => {
    let resolveStats: ((value: { success: true; data: unknown }) => void) | undefined
    chatStatsGet.mockImplementation(
      () => new Promise((resolve) => { resolveStats = resolve }) as ReturnType<typeof api.chatStats.get>,
    )
    await act(async () => { root.render(<InboxKpis />) })

    const section = host.querySelector('section[aria-label="受信箱の対応状況"]')
    expect(section?.getAttribute('aria-busy')).toBe('true')
    // 「要返信」＋4指標＋待ち時間の骨組み。実数の「—」は出さない。
    expect(host.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(5)
    expect(section?.textContent).not.toContain('—')

    const stats = {
      waiting: 3,
      oldestWaitingMinutes: 42,
      mine: 1,
      todayInbound: 5,
      todayByChannel: { email: 2 },
      waitingOverAnHour: 1,
    }
    await act(async () => {
      resolveStats?.({ success: true, data: stats })
    })
    expect(section?.getAttribute('aria-busy')).toBeNull()
    expect(host.querySelectorAll('.animate-pulse').length).toBe(0)
    expect(section?.textContent).toContain('要返信 3件')
    expect(section?.textContent).toContain('5件')
  })

  it('ダッシュボードの指標カードも骨組みの口を持つ', () => {
    const page = readFileSync(join(HERE, 'page.tsx'), 'utf8')
    // LiveDataCard / TodayTaskCard / SendQuotaCard が loading を受け取り、
    // 読込中は「—」ではなく animate-pulse の骨組みを出す。
    expect(page).toMatch(/function LiveDataCard[\s\S]*?loading = false/)
    expect(page).toMatch(/aria-busy=\{loading \|\| undefined\}/)
    expect(page).toContain('animate-pulse')
  })
})
