import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

describe('一覧KPIの取得失敗時', () => {
  it('利用中の全画面が4枚の見出しを渡す', () => {
    const callers = [
      'app/scenarios/page.tsx',
      'app/reminders/page.tsx',
      'app/templates/page.tsx',
      'components/friend-fields/tags-page-v4.tsx',
    ]

    for (const path of callers) {
      expect(read(path), `${path} に titles がありません`).toMatch(/<ListKpis[\s\S]*?titles=/u)
    }
  })

  it('取れなかった数を0件にせず、見出しと取得失敗を表示する', () => {
    const source = read('components/shared/list-kpis.tsx')
    expect(source).toContain("title: failed ? titles?.[i] ?? '' : ''")
    expect(source).toContain("detail: failed && titles ? '取得できませんでした' : ''")
    expect(source).toContain('value: null')
  })
})
