import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * #1058: 運営コンソールのエラー処理。
 * - 「1件も無い」と「読み込めなかった」を言い分ける。失敗時は空の案内の
 *   代わりにエラー表示と再読み込みを出す（並びは knowledge-list と同じ）。
 * - fetchApi の例外（4xx/5xx）は opsCall で { success: false } に直して受ける。
 *   生のまま await すると setBusy/setLoaded が走らず画面が固まる。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

const LIST_PAGES = [
  { name: 'tenants', path: 'tenants/page.tsx', empty: '該当する契約先がありません' },
  { name: 'announcements', path: 'announcements/page.tsx', empty: 'まだお知らせはありません' },
  { name: 'audit', path: 'audit/page.tsx', empty: '記録がありません' },
  { name: 'members', path: 'members/page.tsx', empty: '運営メンバーがいません' },
]

describe.each(LIST_PAGES)('$name の一覧', ({ path, empty }) => {
  const page = read(path)

  it('読み込み失敗は空の案内ではなくエラー表示にする', () => {
    expect(page).toContain(empty)
    const error = page.indexOf('kind="error"')
    const emptyAt = page.indexOf('kind="empty"')
    expect(error).toBeGreaterThan(-1)
    expect(error).toBeLessThan(emptyAt)
  })

  it('エラー表示には再読み込みを付ける', () => {
    expect(page).toContain('onRetry={() => void load()}')
  })
})

describe('例外を投げる API の受け方', () => {
  it('メンバー管理は Promise.all の中でも opsCall を通す', () => {
    const page = read('members/page.tsx')
    expect(page).toContain('Promise.all([opsCall(api.ops.members()), opsCall(api.ops.me())])')
    expect(page).not.toContain('Promise.all([api.ops.members()')
  })

  it('2要素認証の確認は opsCall で受け、HTTP エラーも画面へ出す', () => {
    const page = read('two-factor/page.tsx')
    expect(page).toContain('opsCall(api.staff.confirmTwoFactorSetup')
    expect(page).not.toContain('await api.staff.confirmTwoFactorSetup')
  })

  it('ダッシュボードは失敗時にセクションを読み込み中のまま残さない', () => {
    const page = read('dashboard/page.tsx')
    expect(page).toContain('!data && error')
    expect(page).toContain('ダッシュボードを表示できませんでした')
    // ダイアログも「読み込んでいます」のままにしない。
    expect(page).toContain('unregisteredError')
    expect(page).toContain('未登録の人を表示できませんでした')
  })
})
