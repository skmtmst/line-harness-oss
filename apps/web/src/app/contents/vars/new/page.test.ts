import { readUiSource as readFileSync } from '../../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/*
 * 新規作成の動き（社内メモを登録の口へ渡す・秘密値の警告から入力へ戻る・型別の入力エラー・
 * 400/409/通信障害の言い分け・必須の印）は `page-behavior.test.tsx` と
 * `../edit/page-redisplay.test.tsx` が描いて押して守る。ここは一言で片付ける文へ戻さない見張りだけ。
 */
describe('共通情報の新規作成', () => {
  it('VAR-06: 型別の入力エラーを「保存に失敗しました」で隠す文に戻さない', () => {
    expect(PAGE).not.toContain('保存に失敗しました。通信を確かめて、もう一度お試しください。')
  })
})
