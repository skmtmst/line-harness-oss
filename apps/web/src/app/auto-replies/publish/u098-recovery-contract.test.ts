import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (p: string) => readFileSync(join(SRC, p), 'utf8')

const PUBLISH = read('app/auto-replies/publish/page.tsx')
const RUN_DETAIL = read('app/friend-add-settings/runs/detail/page.tsx')
const PUBLISHED = read('app/webinars/published/page.tsx')
const FRIEND_DETAIL = read('app/mileage/friends/detail/page.tsx')

/*
 * #975 U098: 読み込みに失敗した・対象がない画面が「再読み込み」だけを
 * 繰り返し出していた。状況に合った次の動き（一覧へ戻る、アカウントを
 * 選ぶ、別の実施を見る）を出す。
 */
describe('再読み込みだけにしない（#975 U098）', () => {
  it('公開する自動応答は、対象未指定・権限なし・失敗を分けて案内する', () => {
    expect(PUBLISH).toContain("loadState === 'missing'")
    expect(PUBLISH).toContain('公開する自動応答が指定されていません')
    expect(PUBLISH).toContain('この自動応答を有効化する権限がありません')
    expect(PUBLISH).toContain('href="/auto-replies"')
    expect(PUBLISH).toContain('自動応答の一覧へ戻る')
    expect(PUBLISH).toContain('再読み込み')
  })

  it('追加設定の実施詳細は、対象未指定・アカウント未選択・失敗で履歴へ戻れる', () => {
    expect(RUN_DETAIL).toContain('見る実行詳細が指定されていません')
    expect(RUN_DETAIL).toContain('LINEアカウントを選んでください')
    expect(RUN_DETAIL).toContain('href="/friend-add-settings/runs"')
    expect(RUN_DETAIL).toContain('実行履歴の一覧へ戻る')
    expect(RUN_DETAIL).toContain('もう一度読み込む')
    expect(RUN_DETAIL).toContain('対象の記録が見つかりません')
  })

  it('公開ウェビナーは、対象未指定と読み込み失敗を分けて案内する', () => {
    expect(PUBLISHED).toContain('確認するウェビナーが指定されていません')
    expect(PUBLISHED).toContain('公開したウェビナーが見つかりませんでした')
    expect(PUBLISHED).toContain('href="/webinars"')
    expect(PUBLISHED).toContain('ウェビナー一覧へ戻る')
    expect(PUBLISHED).toContain('もう一度読み込む')
  })

  it('マイレージの友だち詳細は、対象未指定・アカウント未選択・失敗で一覧へ戻れる', () => {
    expect(FRIEND_DETAIL).toContain('マイル明細を見る友だちが指定されていません')
    expect(FRIEND_DETAIL).toContain('LINEアカウントを選択してください')
    expect(FRIEND_DETAIL).toContain('href="/friends"')
    expect(FRIEND_DETAIL).toContain('友だち一覧へ戻る')
    expect(FRIEND_DETAIL).toContain('マイル明細を再読み込み')
    expect(FRIEND_DETAIL).toContain('友だちが選択中のLINEアカウントにいるか確認して')
  })
})
