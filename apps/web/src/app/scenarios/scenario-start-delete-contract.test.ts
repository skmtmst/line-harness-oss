import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * 点検 #495 中4・中6 の再発防止。
 *
 * 中4: 開始は戻せない操作なのに、確認のチェックが defaultChecked の
 * 非制御で、未チェックでも「配信を開始」を押せた。
 * 中6: 削除の戻りの success を見ていなかった。fetchApi は口の失敗時も
 * 例外でなく {success:false} を返すため、消えていないのに再読込だけ
 * されて気づけなかった。
 */
describe('シナリオ一覧の開始確認と削除（点検 #495 中4・中6）', () => {
  it('確認チェックは制御化し、未チェックの間は開始ボタンを押せない', () => {
    expect(PAGE).toContain('checked={confirmed}')
    expect(PAGE).toContain('setConfirmed(event.target.checked)')
    expect(PAGE).toContain('disabled={busy || !confirmed}')
  })

  it('確認チェックを非制御（defaultChecked）に戻さない', () => {
    expect(PAGE).not.toMatch(/<input[^>]*defaultChecked/)
  })

  it('削除は戻りの success を見て、失敗時は帯に出す', () => {
    expect(PAGE).toContain('const res = await api.scenarios.delete(id)')
    expect(PAGE).toContain('if (!res.success) throw new Error(res.error)')
    expect(PAGE).toContain('シナリオを削除できませんでした。')
  })
})
