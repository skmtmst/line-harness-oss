import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 作る①（配信方式）の保存・読み込み・フォルダの動きは v8/scenarios/create-existing.test.tsx と
 * create-results.test.tsx が描いて押して守る。ここは API の内部の文をそのまま出す書き方と、
 * 保存せずに3段目へ飛ぶリンクへ戻さない禁止の見張りだけを残す。
 */
const page = readFileSync(new URL('../../../v8/scenarios/create.tsx', import.meta.url), 'utf8')

describe("管理画面 シナリオ作成・配信方式 cCB7r", () => {
  it('下書きで続ける場合も名前とフォルダの保存成功後だけ進む', () => {
    expect(page).not.toContain('href={`/scenarios/first-step')
  })

  it('APIの内部エラーをそのまま利用者へ出さない', () => {
    expect(page).not.toContain('setError(res.error)')
  })
})
