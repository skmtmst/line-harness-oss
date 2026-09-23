import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const DIALOGS = readFileSync(new URL('./action-dialogs.tsx', import.meta.url), 'utf8')

describe('/affiliates から /conversions への付け替え (#1058)', () => {
  it('?tab= を落とさず、/conversions が持つタブへそのまま渡す', () => {
    expect(PAGE, 'URLのクエリを読んでいない').toContain('useSearchParams')
    expect(PAGE).toContain("params.get('tab')")
    // 「案件」タブ（/affiliate-offers から来る）が落ちないことが本題
    expect(PAGE).toContain("'offers'")
    expect(PAGE).toMatch(/router\.replace\(`\/conversions\?tab=\$\{/)
  })

  it('tab無し・知らないtabは「アフィリエイター」タブを開く', () => {
    // /conversions の既定タブは成果地点なので、無指定でもそこへ落とさない
    expect(PAGE).toContain("'affiliates'")
    expect(PAGE).toMatch(/CONVERSIONS_TABS\.has\(tab\) \? tab : 'affiliates'/)
  })

  it('静的書き出しで redirect() をサーバー側へ置かない', () => {
    // output: 'export' では redirect() にクエリを読ませられない
    expect(PAGE).toContain("'use client'")
    expect(PAGE).not.toContain("redirect('/conversions")
    // useSearchParams は Suspense の内側でだけ使う
    expect(PAGE).toContain('<Suspense>')
  })
})

describe('アーカイブ確認の「ここを開く」 (#1058)', () => {
  it('発行ずみの紹介リンクは /conversions の案件タブへ直接つなぐ', () => {
    expect(DIALOGS).toContain('href="/conversions?tab=offers">ここを開く')
    // 旧URL経由にすると /affiliate-offers → /affiliates → /conversions と
    // 2回リダイレクトを踏む。行き先は直接書く。
    expect(DIALOGS).not.toContain('href="/affiliate-offers"')
  })
})
