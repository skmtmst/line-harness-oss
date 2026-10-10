import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')
const HQ_LIST = readFileSync(join(SRC, 'components', 'hq', 'account-list.tsx'), 'utf8')
const ACCOUNTS = readFileSync(join(SRC, 'app', 'accounts', 'page.tsx'), 'utf8')
const MEMBERS = readFileSync(join(SRC, 'v8', 'hq', 'members.tsx'), 'utf8')

/*
 * #975 U042: 統括（/hq）・アカウント一覧（/accounts）・権限者
 * （/hq/members）の表は、390pxでは右端の操作（ログイン・詳細・権限変更）
 * へ横スクロールしないと届かなかった。
 *
 * 直し方: 768px 未満では行頭の名前＋状態＋操作を持つカードへ切り替え、
 * 数値などの詳細は開いて確認する形にする。768px 以上では既存の表のまま。
 */
describe('行操作を見える位置へ（#975 U042）', () => {
  it('統括の店舗一覧はスマホでカードになり、操作が行頭側にある', () => {
    expect(HQ_LIST).toContain('md:hidden')
    expect(HQ_LIST).toContain('hidden w-full overflow-x-auto md:block')
    // カードは「List」の節の狭い画面向けの出し方（節名は増やさない）。
    expect(HQ_LIST).toContain('data-design="List"')
    expect(HQ_LIST).toContain('onSelect(account.id)')
    // 詳細な数値は開いて確認する。
    expect(HQ_LIST).toContain('<details')
  })

  it('アカウント一覧はスマホでカードになり、「詳細」が各カードにある', () => {
    expect(ACCOUNTS).toContain('data-design="List"')
    expect(ACCOUNTS).toContain('md:hidden')
    expect(ACCOUNTS).toContain('hidden overflow-x-auto md:block')
    expect(ACCOUNTS).toContain('/accounts/detail?id=')
  })

  it('権限者の変更・再送は各行にあり、操作権限がある人だけに出す', () => {
    expect(MEMBERS).toContain('role="table"')
    expect(MEMBERS).toContain('onClick={() => openChange(member)}')
    expect(MEMBERS).toContain('canManage && canResendInvite(member)')
    expect(MEMBERS).toContain('onClick={() => void resend(member)}')
    expect(MEMBERS).toContain('aria-label={`${member.name}さんの権限を変更`}')
  })
})
