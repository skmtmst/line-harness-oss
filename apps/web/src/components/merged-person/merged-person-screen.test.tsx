import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MergedPersonDetail } from '@line-crm/shared'
import MergedDeliveryDialog from './merged-delivery-dialog'
import {
  MergedAdminCard,
  MergedDeliveryCard,
  MergedFriendsTable,
  MergedHistoryTable,
  MergedProfileCard,
  MergedProfileValues,
} from './merged-person-sections'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

/**
 * 画面確認（`scripts/visual-qa/fixtures.mjs` の `MERGED_PERSON_DETAIL`）と
 * 同じ形。別の形で書くと、試験は通るのに画面は落ちる。型を通して固定する。
 */
const PERSON: MergedPersonDetail = {
  id: 'merged-person-1', status: 'active', revision: 4, primaryDisplayName: '田中 花子',
  linkedFriends: [
    {
      friendId: 'friend-identity-right', displayName: '田中 花子',
      lineAccountId: 'visual-qa-account', lineAccountName: '本店', isFollowing: true,
      linkedAt: '2026-08-28T10:00:00.000Z', linkMethod: 'operator_review', confidence: 92,
      candidateId: 'identity-friend-1', candidateVersion: 2,
    },
    {
      friendId: 'friend-identity-left', displayName: '田中 はなこ',
      lineAccountId: 'visual-qa-account-sub', lineAccountName: '支店', isFollowing: true,
      linkedAt: '2026-08-28T10:00:00.000Z', linkMethod: 'migration', confidence: null,
      candidateId: null, candidateVersion: null,
    },
  ],
  profileValues: [
    {
      fieldKey: 'email', fieldLabel: 'メールアドレス', valuePreview: 'ta***@example.jp',
      sourceType: 'form', sourceLabel: '来店アンケート', sourceFriendId: 'friend-identity-right',
      verifiedAt: '2026-08-28T09:00:00.000Z', selectedByName: '画面確認',
      selectedAt: '2026-08-28T10:10:00.000Z', updateMode: 'fixed',
    },
    {
      fieldKey: 'phone', fieldLabel: '電話番号', valuePreview: '090-****-0001',
      sourceType: 'friend_field', sourceLabel: '支店の友だち情報',
      sourceFriendId: 'friend-identity-left', verifiedAt: null, selectedByName: '画面確認',
      selectedAt: '2026-08-28T10:12:00.000Z', updateMode: 'auto',
    },
  ],
  deliveryPriorities: [
    {
      purpose: 'broadcast', friendId: 'friend-identity-right',
      lineAccountId: 'visual-qa-account', lineAccountName: '本店', priority: 1,
      isActive: true, reason: '通常の配信は本店から送ります',
    },
    {
      purpose: 'broadcast', friendId: 'friend-identity-left',
      lineAccountId: 'visual-qa-account-sub', lineAccountName: '支店', priority: 2,
      isActive: true, reason: '本店から送れないときの代替です',
    },
  ],
  history: [
    {
      id: 'merged-event-1', eventType: 'link', summary: '本人照合で友だちを結び付けました',
      actorName: '画面確認', occurredAt: '2026-08-28T10:00:00.000Z',
    },
  ],
  createdAt: '2026-08-28T10:00:00.000Z', updatedAt: '2026-08-28T10:12:00.000Z',
  archivedAt: null,
}

const ALL = () =>
  [
    renderToStaticMarkup(<MergedProfileCard person={PERSON} />),
    renderToStaticMarkup(<MergedDeliveryCard priorities={PERSON.deliveryPriorities} onEdit={() => {}} />),
    renderToStaticMarkup(<MergedAdminCard person={PERSON} />),
    renderToStaticMarkup(<MergedFriendsTable friends={PERSON.linkedFriends} />),
    renderToStaticMarkup(<MergedProfileValues values={PERSON.profileValues} />),
    renderToStaticMarkup(<MergedHistoryTable history={PERSON.history} />),
  ].join('')

describe('統合ユーザー詳細の中身', () => {
  it('操作用のIDを本文へ出さない', () => {
    const html = ALL()
    // friendId は「友だちを開く」の行き先にだけ使う。本文には出さない。
    expect(html).not.toContain('>friend-identity-right<')
    expect(html).not.toContain('>friend-identity-left<')
    expect(html).not.toContain('identity-friend-1')
    expect(html).not.toContain('visual-qa-account')
    expect(html).not.toContain('merged-person-1')
  })

  it('メール・電話はマスク済みの値だけを出す', () => {
    const html = ALL()
    expect(html).toContain('ta***@example.jp')
    expect(html).toContain('090-****-0001')
    expect(html).not.toContain('tanaka@example.jp')
    expect(html).not.toContain('090-1234-0001')
  })

  it('未取得と取得できた値を見分けられる', () => {
    const html = renderToStaticMarkup(<MergedFriendsTable friends={PERSON.linkedFriends} />)
    // 本店は 92%、移行で入った支店は記録が無いので「—」。
    expect(html).toContain('92%')
    expect(html).toContain('—')
    expect(html).not.toContain('0%')
  })

  it('採用元と、いつ誰が決めたかを出す', () => {
    const html = renderToStaticMarkup(<MergedProfileValues values={PERSON.profileValues} />)
    expect(html).toContain('回答フォーム')
    expect(html).toContain('来店アンケート')
    expect(html).toContain('この値で固定')
    expect(html).toContain('新しい値で自動更新')
    expect(html).toContain('未確認')
    expect(html).toContain('画面確認')
  })

  it('用途ごとに優先順を並べ、使う・使わないを言う', () => {
    const html = renderToStaticMarkup(
      <MergedDeliveryCard priorities={PERSON.deliveryPriorities} onEdit={() => {}} />,
    )
    expect(html).toContain('一斉配信')
    expect(html).toContain('本店')
    expect(html).toContain('支店')
    expect(html).toContain('使う')
    expect(html).toContain('優先順位を変更')
  })

  it('読み込んだ版を出す（保存に付けて送るもの）', () => {
    expect(renderToStaticMarkup(<MergedAdminCard person={PERSON} />)).toContain('第4版')
  })
})

describe('取得できた0件を「まだありません」と書く', () => {
  it('失敗と同じ文にしない', () => {
    const friends = renderToStaticMarkup(<MergedFriendsTable friends={[]} />)
    expect(friends).toContain('結び付いている友だちはまだありません。')
    expect(friends).not.toContain('表示できませんでした')

    const values = renderToStaticMarkup(<MergedProfileValues values={[]} />)
    expect(values).toContain('採用した値はまだありません。')
    expect(values).toContain('統合された属性 0件')

    const history = renderToStaticMarkup(<MergedHistoryTable history={[]} />)
    expect(history).toContain('まだ記録がありません。')

    const delivery = renderToStaticMarkup(<MergedDeliveryCard priorities={[]} onEdit={() => {}} />)
    expect(delivery).toContain('優先順はまだ決めていません。')
  })
})

describe('配信元を変える窓', () => {
  it('読み込んだ版を見せ、順の入れ替えと使う・使わないを出す', () => {
    const html = renderToStaticMarkup(
      <MergedDeliveryDialog
        open
        priorities={PERSON.deliveryPriorities}
        revision={4}
        busy={false}
        onCancel={() => {}}
        onSave={() => {}}
      />,
    )
    expect(html).toContain('読み込んだのは第4版です')
    expect(html).toContain('上へ')
    expect(html).toContain('下へ')
    expect(html).toContain('使わない')
    expect(html).toMatch(/<button[^>]*>保存する</)
  })

  it('全部を「使わない」にしたら、承知の印がつくまで保存できない', () => {
    const none = PERSON.deliveryPriorities.map((row) => ({ ...row, isActive: false }))
    const html = renderToStaticMarkup(
      <MergedDeliveryDialog
        open
        priorities={none}
        revision={4}
        busy={false}
        onCancel={() => {}}
        onSave={() => {}}
      />,
    )
    expect(html).toContain('この人へはどこからも送れなくなります')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>保存する</)
  })
})

describe('画面のつなぎ', () => {
  const detail = read('components/merged-person/merged-person-detail.tsx')
  const row = read('components/users/user-row.tsx')
  const page = read('app/users/page.tsx')

  it('撮影の押し口と対象面に印を付ける', () => {
    expect(row).toContain('data-qa-open="w8W4Eh"')
    expect(detail).toContain('data-design-node="w8W4Eh"')
  })

  it('読込・失敗・権限不足は面ごと差し替える', () => {
    for (const kind of ['loading', 'forbidden', 'error']) {
      expect(detail).toContain(`kind="${kind}"`)
    }
  })

  it('保存に読み込んだ版を付ける', () => {
    expect(detail).toContain('expectedRevision: person.revision')
  })

  it('同じ画面を二重に作らず、一覧の面を差し替える', () => {
    expect(page).toContain('MergedPersonDetailView')
    expect(page).toContain('openedPersonId')
  })
})
