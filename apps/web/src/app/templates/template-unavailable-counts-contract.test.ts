import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const TABS = readFileSync(join(HERE, '../../components/shared/tabs.tsx'), 'utf8')
const FOLDERS = readFileSync(join(HERE, '../../components/shared/folder-panel.tsx'), 'utf8')

describe('V6 テンプレートの未取得と0件', () => {
  it('取得していない件数を0件と表示しない', () => {
    expect(PAGE).toContain("const countsUnavailable = !selectedAccountId || Boolean(loadError)")
    expect(PAGE).toContain("count: accountLoading || loading ? undefined : countsUnavailable ? '—' : templates.length")
    expect(PAGE).toContain("total={countsUnavailable ? '—' : `${folders.length}件`}")
    expect(PAGE).toContain("count: countsUnavailable ? '—' : unfiledCount")
  })

  it('素材ごとの件数も取得失敗と読込中を分ける', () => {
    expect(PAGE).toContain("undefined = 読み込み中、null = 取得失敗、number = 取得済み")
    expect(PAGE).toContain("return count === null ? '—' : count")
    expect(PAGE).toContain("return [kind, null] as const")
  })

  it('共通タブとフォルダは未取得の記号を表示できる', () => {
    expect(TABS).toContain('count?: number | string')
    expect(FOLDERS).toContain('count: number | string')
  })

  it('FlexとCarouselを運用者向けの言葉で出す', () => {
    expect(PAGE).toContain("flex: 'カード型'")
    expect(PAGE).toContain("carousel: 'カルーセル'")
    expect(PAGE).not.toContain("label: 'Flex'")
    expect(PAGE).not.toContain('Flex JSON parse 失敗')
  })
})
