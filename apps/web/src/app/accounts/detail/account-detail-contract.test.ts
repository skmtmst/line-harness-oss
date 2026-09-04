import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DETAIL_TABS,
  accountActions,
  capacityLabel,
  credentialLabel,
  parentLabel,
  toTab,
} from './account-detail-view'
import type { LineAccount } from '@line-crm/shared'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

const account = (over: Partial<LineAccount> = {}): LineAccount => ({
  id: 'a1', channelId: '2007123456', name: '然-NEN- TEST',
  loginChannelId: null, liffId: null, isActive: true,
  createdAt: '', updatedAt: '', country: null, role: null, displayOrder: 0,
  ogSiteName: null, ogDefaultDescription: null, ogDefaultImageUrl: null,
  parentLineAccountId: null,
  ...over,
})

/** LINEアカウントの詳細・編集（設計 ★V6 33-3 `T9rA9`）。 */
describe('V6 33-3 LINEアカウントの詳細・編集', () => {
  it('設計の4タブを持つ', () => {
    expect(DETAIL_TABS.map((t) => t.label)).toEqual(['概要', '接続の確認', '資格情報', '乗り換え'])
  })

  it('知らないタブ名は概要に落とす', () => {
    // `?tab=` は人が書き換えられる。落ちずに既定へ戻す。
    expect(toTab('connection')).toBe('connection')
    expect(toTab('nope')).toBe('overview')
    expect(toTab(null)).toBe('overview')
  })

  it('タブは ?tab= のまま。履歴を積まない', () => {
    // 共有・再読込・戻るに強い（`v6-common-rules.md` §2-2）。
    expect(PAGE).toContain('&tab=${t.value}')
  })

  it('動的セグメントを使わない', () => {
    /*
      この管理画面は静的書き出し（`output: 'export'`）。**ビルド時に全IDが
      分からない `[id]` は書き出せない**（`route-integrity.test.ts`）。
      ほかの詳細画面と同じく `?id=` で表す。
    */
    expect(PAGE).toContain("search?.get('id')")
    expect(PAGE).toContain('/accounts/detail?id=')
  })

  it('資格情報の値そのものを出さない', () => {
    /*
      **末尾4文字と更新日は API がまだ返さない**（台帳 #132）。
      作れないものを作らず、出せないと書く。
    */
    expect(credentialLabel(true)).toBe('入っています（末尾と更新日はまだ出せません）')
    expect(credentialLabel(false)).toBe('入っていません')
    expect(credentialLabel(undefined)).toBe('入っていません')
    expect(PAGE).toContain('値そのものは、ここにも出しません')
  })

  it('親が無いことを「なし」で済ませない', () => {
    /*
      「なし」だと、決め忘れなのか意図なのかが分からない。
      設計の言葉は「なし（このアカウントが親）」。
    */
    expect(parentLabel(account(), [])).toBe('なし（このアカウントが親）')
    const parent = account({ id: 'p1', name: '然-NEN- 本番' })
    expect(parentLabel(account({ parentLineAccountId: 'p1' }), [parent])).toBe('然-NEN- 本番')
    // 親が消えていたら `—`。IDを出さない。
    expect(parentLabel(account({ parentLineAccountId: 'gone' }), [])).toBe('—')
  })

  it('上限が未設定のときに 0 と書かない', () => {
    expect(capacityLabel(account())).toBe('上限は未設定')
    expect(capacityLabel(account({ friendCapacity: 50000, capacityWarnAt: 45000 })))
      .toBe('上限 50,000／警告 45,000')
    expect(capacityLabel(account({ friendCapacity: 50000 }))).toBe('上限 50,000／警告なし')
  })

  it('できないことは押し口を出さず、理由を書く', () => {
    /*
      `v6-common-rules.md` §7-10「出す＝使える」。
      写す口とアーカイブはまだ無い（台帳 #128）。
    */
    const actions = accountActions(account())
    const blocked = actions.filter((a) => a.blockedReason !== null).map((a) => a.key)
    // 乗り換えの画面（33-4）はこの次。**行き先の無い青字を置かない。**
    expect(blocked).toEqual(['copy', 'handover', 'archive'])
    // 押せるものには理由を付けない。
    expect(actions.find((a) => a.key === 'stop')?.blockedReason).toBeNull()
  })

  it('止める・再開するで言葉が変わる', () => {
    expect(accountActions(account({ isActive: true }))[0].title).toBe('送受信を止める')
    expect(accountActions(account({ isActive: false }))[0].title).toBe('送受信を再開する')
    // 再開のときは「予約を送り直さない」ことを言う。
    expect(accountActions(account({ isActive: false }))[0].description)
      .toContain('自動で送り直しません')
  })

  it('Webhookの利用で「確かめていません」と「オフ」を混ぜない', () => {
    // `active` が null は確かめていない。false と同じにすると、
    // 直す必要があるのか分からない。
    expect(PAGE).toContain("account.webhook?.active === null")
    expect(PAGE).toContain('確かめていません')
  })

  it('止める前に、何が止まって何が残るかを読ませる', () => {
    expect(PAGE).toContain('友だちと履歴はそのまま残ります')
    expect(PAGE).toContain('予約している配信は止まります')
  })
})
