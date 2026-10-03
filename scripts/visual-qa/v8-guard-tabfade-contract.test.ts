import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * V8 screen guard の v7 友だち詳細の誤検知（タブ帯右端の「続きがある」
 * ぼかしが撮る時刻で出たり出なかったり）の再発防止。
 *
 * ぼかしは飾り（aria-hidden）で、はみ出しの実測で出る・出ないが決まる。
 * 比較撮影では隠し、はみ出し自体は layout-overflow が見張る。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8')

describe('タブのぼかしは比較撮影で隠す', () => {
  it('友だち詳細のフェードに目印（data-tab-fade）がある', () => {
    const page = read('../../apps/web/src/app/friends/detail/page.tsx')
    expect(page).toContain('data-tab-fade="right"')
    // 目印だけ足し、出す条件と見た目は変えない
    expect(page).toContain('{tabsOverflowing ? (')
    expect(page).toContain('bg-gradient-to-l')
  })

  it('共通タブの前後フェードに目印（data-scroll-hint）がある', () => {
    const tabs = read('../../apps/web/src/components/layout/scrollable-tabs.tsx')
    expect(tabs).toContain('data-scroll-hint="left"')
    expect(tabs).toContain('data-scroll-hint="right"')
  })

  it('ガードの安定撮影で両方のぼかしを隠す', () => {
    const env = read('../../apps/web/scripts/v8-guard/browser-env.mjs')
    expect(env).toContain('[data-scroll-hint]')
    expect(env).toContain('[data-tab-fade]')
    expect(env).toContain('display:none')
  })
})
