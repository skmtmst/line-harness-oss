import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/* 完全切り替え：v7 の page.tsx は捨て、V8 の一覧（src/v8/scenarios/list.tsx・page.tsx が描く本体）を見る。 */
const PAGE = readFileSync(new URL('../../v8/scenarios/list.tsx', import.meta.url), 'utf8')

/**
 * 点検 #495 中6 の再発防止（V8）。
 *
 * 削除の戻りの success を見ていなかった。fetchApi は口の失敗時も
 * 例外でなく {success:false} を返すため、消えていないのに再読込だけ
 * されて気づけなかった。
 *
 * （中4 の開始前チェックは V8 の一覧には無い。始める前の確認は
 * 詳細画面で行う。）
 */
describe('シナリオ一覧の削除（点検 #495 中6）', () => {
  it('SCENARIO-18: 削除失敗は確認窓へ返し、窓を閉じない', () => {
    expect(PAGE).toContain("throw new Error('シナリオを削除できませんでした')")
  })

  it('確認チェックを非制御（defaultChecked）に戻さない', () => {
    expect(PAGE).not.toMatch(/<input[^>]*defaultChecked/)
  })

  it('削除は戻りの success を見て、失敗時は窓に出す', () => {
    expect(PAGE).toContain('const res = await api.scenarios.delete(id)')
    expect(PAGE).toContain('if (!res.success) throw new Error(res.error)')
    expect(PAGE).toContain('このシナリオを削除できませんでした')
  })
})
