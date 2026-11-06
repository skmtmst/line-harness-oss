import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../../../v8/auto-replies/runs.tsx', import.meta.url), 'utf8')

/*
 * 管理画面 自動応答・実行結果 t7UtYQ。
 * 未取得と 0・読込と失敗と空・知らない状態は runs-states-react.test.tsx が描いて見る。
 * 失敗と見送りの写しは Worker の auto-reply-runs.test.ts が口を呼んで見る。
 */
describe("管理画面 自動応答・実行結果 t7UtYQ", () => {
  it('知らない状態が来ても白い画面にしない（表から直に引かない）', () => {
    expect(page).not.toContain('STATUS[item.status]')
  })
})
