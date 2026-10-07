// @vitest-environment happy-dom
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DelayedSkeleton } from './skeleton'

/*
 * 動きの点検（2026-10-07）8・11 番：読み込み中に後から出る物で画面がずれていた
 * （友だち 0.28・友だち追加時の配信 0.32・流入と計測 0.31・ウェビナー 0.32）。
 * 後から出る物の高さを最初から取っておく／後から差し込まない。
 */
afterEach(() => cleanup())
const src = (path: string) => readFileSync(join(process.cwd(), 'src', path), 'utf8')

describe('骨組みを出すまでの 0.3 秒も高さを取る', () => {
  it('本物を渡さないときは、骨組みを不可視で置いて場所を取る', () => {
    const view = render(<DelayedSkeleton loading skeleton={<div data-testid="bone" style={{ height: 300 }} />} />)
    const reserve = view.container.querySelector('[data-skeleton-reserve]')
    expect(reserve).not.toBeNull()
    expect(reserve?.className).toContain('invisible')
    expect(reserve?.querySelector('[data-testid="bone"]')).not.toBeNull()
  })

  it('読み終えたら本物だけ', () => {
    const view = render(<DelayedSkeleton loading={false} skeleton={<div data-testid="bone" />}><p>本物</p></DelayedSkeleton>)
    expect(view.container.querySelector('[data-skeleton-reserve]')).toBeNull()
    expect(view.container.textContent).toBe('本物')
  })
})

describe('後から出して消す・差し込む物を作らない', () => {
  it('閲覧のみの帯は役割が取れてから出す（友だち追加時の配信・ウェビナー）', () => {
    expect(src('v8/friend-add/list.tsx')).toMatch(/\{role !== null && !canEdit \? \(\s*<div className=\{styles\.viewerBand\}/)
    expect(src('v8/webinars/list.tsx')).toMatch(/\{role !== null && !canEdit \? \(\s*<div className=\{styles\.viewerBand\}/)
  })

  it('左メニューは機能の見え方を読む間、最初の区分だけ出す（「設定」の上に後から差し込まない）', () => {
    expect(src('components/layout/sidebar.tsx')).toMatch(/\.filter\(\(_section, index\) => isHq \|\| currentVisibility !== null \|\| visibilityStatus !== 'loading' \|\| \(!selectedAccountId && !accountLoading\) \|\| index === 0\)/)
  })

  it('数の骨組みは届いた数字と同じ行の高さ', () => {
    const css = src('components/shared/kpi-card.module.css')
    expect(css).toMatch(/\[data-theme='v8'\] \.skeleton \{ height: 32px; \}/)
    expect(css).toMatch(/\[data-kpi-presentation='band'\] \.skeleton \{ height: var\(--tpl-band-number-lh\); \}/)
  })

  it('流入と計測：未設定の知らせは一覧の列の頭（数の帯の下に差し込まない）', () => {
    const page = src('app/inflow-links/page.tsx')
    const notice = page.indexOf('友だちになっても何も起きない経路が')
    expect(notice).toBeGreaterThan(page.indexOf('<FolderPanel'))
    expect(notice).toBeLessThan(page.indexOf('className={styles.tools}'))
  })
})
