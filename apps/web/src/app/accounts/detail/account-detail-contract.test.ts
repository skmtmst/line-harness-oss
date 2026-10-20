import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DETAIL_TABS,
  archiveBlockedReason,
  stateBadge,
  webhookUse,
  summaryLine,
  capacityDetails,
  credentialLine,

  toTab,
} from '@/v8/accounts-detail/view'
import type { LineAccount } from '@line-crm/shared'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '../../../v8/accounts-detail/detail.tsx'), 'utf8') + readFileSync(join(HERE, '../../../v8/accounts-detail/dialogs.tsx'), 'utf8')

const account = (over: Partial<LineAccount> = {}): LineAccount => ({
  id: 'a1', channelId: '2007123456', name: '然-NEN- TEST',
  loginChannelId: null, liffId: null, isActive: true,
  createdAt: '', updatedAt: '', country: null, role: null, displayOrder: 0,
  ogSiteName: null, ogDefaultDescription: null, ogDefaultImageUrl: null,
  parentLineAccountId: null,
  ...over,
})

/** LINEアカウントの詳細・編集（設計 ★管理画面 33-3 `T9rA9`）。 */
describe('V8 LINEアカウントの詳細・編集', () => {
  it('設計の4タブを持つ', () => {
    expect(DETAIL_TABS).toEqual(['overview', 'connection', 'credentials', 'handover'])
  })

  it('知らないタブ名は概要に落とす', () => {
    // `?tab=` は人が書き換えられる。落ちずに既定へ戻す。
    expect(toTab('connection')).toBe('connection')
    expect(toTab('nope')).toBe('overview')
    expect(toTab(null)).toBe('overview')
  })

  it('資格情報とWebhookの見出しを識別でき、履歴を積まない', () => {
    // 共有・再読込・戻るに強い（`docs/v8-design-rules.md` §5）。
    expect(PAGE).toContain('titleId="acd-credentials"')
    expect(PAGE).toContain('id="acd-webhook"')
    expect(PAGE).not.toContain('history.pushState')
  })

  it('?id= なしで開いたとき、無限ローディングにせず一覧へ戻す', () => {
    /*
      `load` は `!id` で何もせず帰るので、ガードがないと
      「読み込んでいます」が消えない（監査 Issue #1058）。
      対象未指定は失敗ではないので、再読み込みではなく一覧への口を出す。
    */
    expect(PAGE).toContain('if (!id)')
    expect(PAGE).toContain('見るアカウントが指定されていません')
    expect(PAGE).toContain('backHref="/accounts"')
  })

  it('動的セグメントを使わない', () => {
    /*
      この管理画面は静的書き出し（`output: 'export'`）。**ビルド時に全IDが
      分からない `[id]` は書き出せない**（`route-integrity.test.ts`）。
      ほかの詳細画面と同じく `?id=` で表す。
    */
    expect(PAGE).toContain("search?.get('id')")
    expect(PAGE).toContain('api.lineAccounts.get(id)')
  })

  it('資格情報の値そのものを出さない', () => {
    /*
      **末尾4文字と更新日は API がまだ返さない**（台帳 #132）。
      作れないものを作らず、出せないと書く。
    */
    expect(credentialLine({configured:true})).toBe('登録済み')
    expect(credentialLine({configured:false})).toBe('未登録')
    expect(credentialLine({configured:undefined})).toBe('未登録')
    expect(PAGE).toContain('秘密値そのものは表示しません')
  })

  it('親が無いことを「なし」で済ませない', () => {
    /*
      「なし」だと、決め忘れなのか意図なのかが分からない。
      設計の言葉は「なし（このアカウントが親）」。
    */
    expect(summaryLine(account(),null)).toContain('親アカウントなし')
    const parent = account({ id: 'p1', name: '然-NEN- 本番' })
    expect(summaryLine(account({ parentLineAccountId: 'p1' }),parent.name)).toContain('親アカウント 然-NEN- 本番')
    // 親が消えていたら `—`。IDを出さない。
    expect(summaryLine(account({ parentLineAccountId: 'gone' }),null)).toContain('親アカウント —')
  })

  it('上限が未設定のときに 0 と書かない', () => {
    expect(capacityDetails(account())).toBe('上限は未設定')
    expect(capacityDetails(account({ friendCapacity: 50000, capacityWarnAt: 45000 })))
      .toBe('上限 50,000／警告 45,000')
    expect(capacityDetails(account({ friendCapacity: 50000 }))).toBe('上限 50,000／警告なし')
  })

  it('できないことは押し口を出さず、理由を書く', () => {
    /*
      `docs/v8-design-rules.md` §5「出す＝使える」。
      写す口だけはまだ無い（台帳 #128）。アーカイブは X-1 で繋いだ。
    */
    expect(PAGE).not.toContain('写す先を選ぶ')
    expect(archiveBlockedReason(account())).toBe('先に送受信を止めてください')
    expect(archiveBlockedReason(account({ isActive: false }))).toBeNull()
    expect(PAGE).toContain('disabled={blocked !== null}')
  })

  it('アーカイブ済みは「戻す」だけを出す', () => {
    expect(stateBadge(account({ archivedAt: '2026-10-01 00:00:00+09:00' })).label).toBe('アーカイブ')
    expect(PAGE).toContain('{account.archivedAt ? (')
    expect(PAGE).toContain('setRestoreTarget(account)')
    expect(PAGE).toContain('アーカイブから戻す')
  })

  it('止める・再開するには理由が必須', () => {
    // X-1: 理由なしの停止を画面から送らせない。入力欄と必須表示が出る。
    expect(PAGE).toContain('止める理由')
    expect(PAGE).toContain('再開する理由')
    expect(PAGE).toContain('（必須）')
  })

  it('止める・再開するで言葉が変わる', () => {
    expect(PAGE).toContain("account.isActive ? '送受信を止める' : '送受信を再開する'")
    expect(PAGE).toContain('自動で送り直しません')
  })

  it('Webhookの利用で「確かめていません」と「オフ」を混ぜない', () => {
    // `active` が null は確かめていない。false と同じにすると、
    // 直す必要があるのか分からない。
    expect(webhookUse(account({ webhook: { active: null } }) as never).label).toBe('確かめていません')
    expect(webhookUse(account({ webhook: { active: false } }) as never).label).toBe('オフ')
  })

  it('止める前に、何が止まって何が残るかを読ませる', () => {
    expect(PAGE).toContain('友だちと履歴は消えません')
    expect(PAGE).toContain('予約した配信は送られません')
  })
})

describe('Webhookの突合カードの縦並び（監査・崩れ2）', () => {
  it('狭い脇カードの4行は札の上・値の下に置く', () => {
    for (const label of ['LINE側に登録したURL', 'Webhookの利用']) {
      expect(PAGE).toContain(`Row label="${label}"`)
    }
    expect(PAGE).toContain('checkedAt: account.connection?.lastTestAt')
    expect(PAGE).toContain('最後の受信 {shortDateTime(lastReceived)}')
  })
})
