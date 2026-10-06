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
  vi.useRealTimers()
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
    // ★V7: ダイアログは最前面（段3）の影 `--shadow-overlay`。
    expect(GLOBALS_CODE).toMatch(/\[data-design-part="dialog"\]\[data-design-node\]\s*\{[^}]*var\(--shadow-overlay\)/)
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
  it('ボタンは motion-instant(80ms) で 0.98倍に沈む（★V7 仕上げ §2）', () => {
    expect(GLOBALS_CODE).toMatch(/:active[\s\S]*?scale:\s*0\.98/)
    expect(GLOBALS_CODE).toMatch(/scale var\(--motion-instant\)/)
    // 旧 #673 の transform: scale(0.97) は scale 規定と二重に効くため外した
    expect(GLOBALS_CODE).not.toContain('transform: scale(0.97)')
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
    // 待ちは偽の時計で進める（本物の時間を待たない）。骨組みの 0.3 秒は描いた瞬間から数えるので、描く前に替える。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    await act(async () => { root.render(<InboxKpis />) })

    const section = host.querySelector('section[aria-label="受信箱の対応状況"]')
    expect(section?.getAttribute('aria-busy')).toBe('true')
    /*
     * ★V7 仕上げ §3: 骨組みは 0.3 秒待ってから出す（速い応答では出さない）。
     * 出る前は本物の場所を不可視で取るので、実数の「—」は見えない。
     * 「要返信」＋4指標＋待ち時間の骨組み。
     */
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })
    expect(host.querySelectorAll('[data-skeleton]').length).toBeGreaterThanOrEqual(5)

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
    // ★V7 §3: 出した骨組みは最低 0.4 秒残る。待ってから実数を確かめる。
    await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    expect(host.querySelectorAll('[data-skeleton]').length).toBe(0)
    expect(section?.textContent).toContain('要返信 3件')
    expect(section?.textContent).toContain('5件')
  })

  it('ダッシュボードの指標カードも骨組みの口を持つ', () => {
    const page = readFileSync(join(HERE, 'page.tsx'), 'utf8')
    // LiveDataCard / TodayTaskCard / SendQuotaCard が loading を受け取り、
    // 読込中は「—」ではなく animate-pulse の骨組みを出す。
    expect(page).toMatch(/function LiveDataCard[\s\S]*?loading = false/)
    expect(page).toMatch(/aria-busy=\{loading \|\| undefined\}/)
    // ★V7 仕上げ §3: 骨組みは共有の Skeleton/DelayedSkeleton（0.3秒遅延・0.4秒最低表示）。
    expect(page).toContain('DelayedSkeleton')
    expect(page).toContain('Skeleton')
  })
})
