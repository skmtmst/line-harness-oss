import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

describe('一覧KPIの取得失敗時', () => {
  it('利用中の全画面が4枚の見出しを渡す', () => {
    const callers = [
      'components/friend-fields/tags-page-v4.tsx',
    ]

    for (const path of callers) {
      expect(read(path), `${path} に titles がありません`).toMatch(/<ListKpis[\s\S]*?titles=/u)
    }
  })

  it('V8 のリマインダ・シナリオは取れない数を「—」で出す', () => {
    // 板 `apLqS`・`axFrW`：ListKpis は使わず、取れない値は「—」。
    // シナリオの入口は src/v8/scenarios/list.tsx（古い app/scenarios/list-v8.tsx はもう描かれない）。
    for (const path of ['app/reminders/list-v8.tsx', 'v8/scenarios/list.tsx']) {
      expect(read(path), `${path} に「—」の欠け表示がありません`).toContain("? '—'")
    }
  })

  it('取れなかった数を0件にせず、見出しと取得失敗を表示する', () => {
    const source = read('components/shared/list-kpis.tsx')
    expect(source).toContain("title: failed ? titles?.[i] ?? '' : ''")
    expect(source).toContain("detail: failed && titles ? '取得できませんでした' : ''")
    expect(source).toContain('value: null')
  })
})
