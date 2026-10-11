import { describe, expect, it } from 'vitest'
// @ts-expect-error 撮影用スクリプトは素のJS。
import { applyBoardStateProfiles, BOARD_STATE_PROFILES } from './measure2-board-state.mjs'
// @ts-expect-error 共通の見本も素のJS。
import { RICH_MENU_GROUP_DETAILS, BROADCASTS } from './fixtures.mjs'

// JSの見本は画面ごとに異なる形。試験で扱う行の境界だけを明示する。
type FixtureRow = Record<string, any>

describe('板ごとの撮影条件', () => {
  it('普通のリッチメニュー一覧の見本だけを4行にし、元のAPIと見本を保持する', () => {
    const account = { match: 'GET /api/line-accounts$', body: { success: true, data: [] } }
    const input = { boards: { rZEGN: { url: '/rich-menus', state: { api: account } } } }
    const before = structuredClone(input)
    const result = applyBoardStateProfiles(input)
    expect(input).toEqual(before)
    const rules = result.boards.rZEGN.state.api
    expect(rules.at(-1)).toEqual(account)
    const groups = rules.find((rule: FixtureRow) => rule.match === 'GET /api/rich-menu-groups$').body.data
    expect(groups.total).toBe(groups.items.length)
    expect(groups.facets.published).toBe(groups.items.filter((group: FixtureRow) => group.status === 'published').length)
    expect(groups.items.some((group: FixtureRow) => group.id === 'rich-menu-safe')).toBe(false)
    expect(groups.items.find((group: FixtureRow) => group.id === 'rmg-autumn').publishingAt > new Date().toISOString()).toBe(true)
  })
  it('作成状態は保存や本文入力をせず、開く操作だけで再現する', () => {
    const clicks = (Object.values(BOARD_STATE_PROFILES) as FixtureRow[]).flatMap((profile: FixtureRow) => profile.click ?? [])
    expect(clicks).not.toEqual([])
    expect(clicks.some(step => step.startsWith('fill:'))).toBe(false)
    expect(BOARD_STATE_PROFILES.HfK0O.click).toEqual(['メッセージ', 'テンプレートを作る'])
  })
  it('固定表を変えず、対象外の状態と対象板のAPI・権限・幅を残す', () => {
    const map = {
      frozenAt: 'fixed',
      boards: {
        HfK0O: { url: '/hq/templates', width: 1152, state: { role: 'owner', api: { match: 'GET /api/x', body: { value: 1 } }, localStorage: { selected: 'account-a' } } },
        other: { url: '/other', state: { manual: '手動', role: 'viewer', click: ['見る'] } },
      },
    }
    const before = structuredClone(map)
    const result = applyBoardStateProfiles(map)
    expect(map).toEqual(before)
    expect(result.frozenAt).toBe('fixed')
    expect(result.boards.other).toEqual(before.boards.other)
    expect(result.boards.HfK0O.width).toBe(1152)
    for (const key of ['api', 'role', 'localStorage']) expect(result.boards.HfK0O.state[key]).toEqual(before.boards.HfK0O.state[key as keyof typeof before.boards.HfK0O.state])
    result.boards.HfK0O.state.localStorage.selected = 'account-b'
    expect(map.boards.HfK0O.state.localStorage.selected).toBe('account-a')
  })

  it.each([
    { state: { role: 'viewer' } },
    { state: { manual: '失敗状態を撮る' } },
    { state: { click: ['特定の確認窓を開く'] } },
    { kind: '閲覧のみ' },
  ])('対象板に既存の再現条件がある場合は上書きしない: %j', entry => {
    const map = { boards: { HfK0O: { url: '/hq/templates', ...entry } } }
    const before = structuredClone(map)
    expect(() => applyBoardStateProfiles(map)).toThrow('既存の状態指定')
    expect(map).toEqual(before)
  })

  it.each([
    ['i0Ao0R', 'template', 6], ['DzdC3', 'tag', 6], ['wZPua', 'form', 5], ['noVq4', 'rich_menu', 4],
  ])('統括の普通の一覧 %s は同じ種類の見本だけを返し、配布数とフォルダが矛盾しない', (id, type, size) => {
    const profile = BOARD_STATE_PROFILES[id as keyof typeof BOARD_STATE_PROFILES]
    const rules = 'api' in profile ? profile.api : []
    const rows = rules.find((rule: FixtureRow) => rule.match === 'GET /api/hq/templates$')!.body.data
    const folders = rules.find((rule: FixtureRow) => rule.match === 'GET /api/hq/templates/folders$')!.body.data
    expect(rows).toHaveLength(size as number)
    expect(rows.every((row: FixtureRow) => row.template_type === type)).toBe(true)
    expect(new Set(rows.map((row: FixtureRow) => row.id)).size).toBe(rows.length)
    for (const row of rows) {
      expect(row.distributed_account_count).toBe(row.distributed_account_names.length)
      if (row.folder_id) expect(folders.some((folder: FixtureRow) => folder.id === row.folder_id)).toBe(true)
    }
    expect(rules.every((rule: FixtureRow) => rule.match.startsWith('GET '))).toBe(true)
  })

  it('板が無い表に、勝手に板を作り足さない', () => {
    expect(applyBoardStateProfiles({ boards: {} })).toEqual({ boards: {} })
    expect(() => applyBoardStateProfiles({})).toThrow('boards')
  })

  it('掲載の撮影は同じ8枚の掲載順と写真ごとの同意を使い、累計を30日集計にしない', () => {
    const profile = BOARD_STATE_PROFILES.SyQA1
    expect(profile.url).toBe('/nen-members?tab=publications')
    const data = profile.api[0].body.data
    expect(data.items).toHaveLength(data.summary.publishedCount)
    expect(new Set(data.items.map((item: FixtureRow) => item.id)).size).toBe(8)
    expect(data.items[0].pet_name).toBe('こむぎちゃん')
    expect(data.items[1].hide_owner_name).toBe(0)
    expect(data.items.every((item: FixtureRow) => item.view_count_30_days == null)).toBe(true)
  })

  it('一括配信の撮影は送れた数を対象数以下に保ち、フォルダの数を現物から数える', () => {
    const profile = BOARD_STATE_PROFILES.U4Eep0
    const rows = profile.api[0].body.data
    const folders = profile.api[1].body.data
    expect(rows).toHaveLength(24)
    expect(rows.some((row: FixtureRow) => row.targets.every((target: FixtureRow) => target.status === 'sent'))).toBe(true)
    expect(rows.some((row: FixtureRow) => row.status === 'prepared')).toBe(true)
    for (const row of rows) for (const target of row.targets) {
      expect(target.successCount).toBeLessThanOrEqual(target.totalCount)
      expect(target.excluded).toBe(false)
    }
    for (const folder of folders) expect(folder.item_count).toBe(rows.filter((row: FixtureRow) => row.input.folderId === folder.id).length)
    expect(profile.api.every((rule: FixtureRow) => rule.match.startsWith('GET '))).toBe(true)
  })

  it('公開のつながりを撮っても、編集の下書きは公開状態にしない', () => {
    const group = BOARD_STATE_PROFILES.wxIQ7.api[0].body.data
    expect(group.status).toBe('published')
    expect(group.pages.every((page: FixtureRow) => Boolean(page.lineRichmenuId))).toBe(true)
    expect(RICH_MENU_GROUP_DETAILS['rmg-1'].status).toBe('draft')
  })

  it('解約のお知らせは設定・定義・集計が同じ解約イベントを指す', () => {
    const rules = BOARD_STATE_PROFILES.g3iDs.api
    const settings = rules[0].body.data
    const definition = rules[1].body.data.find((row: FixtureRow) => row.name === '定期便を止めた')
    expect(definition.sourceEventType).toBe('ec.subscription.cancelled')
    expect(settings.find((row: FixtureRow) => row.label === definition.name).eventType).toBe(definition.sourceEventType)
    expect(rules[2].body.data.byEventType.some((row: FixtureRow) => row.eventType === definition.sourceEventType)).toBe(true)
  })
  it('回答の質問の名前は入力・回答の列・評価集計で同じ鍵を持つ', () => {
    const [form, submissions] = BOARD_STATE_PROFILES.v0SbYR.api.map((rule: FixtureRow) => rule.body.data)
    const field = form.fields.find((field: FixtureRow) => field.name === 'staff')
    const block = form.layout.sections.flatMap((section: FixtureRow) => section.blocks).find((block: FixtureRow) => block.name === 'staff')
    const summary = submissions.summary.ratingFields.find((field: FixtureRow) => field.key === 'staff')
    expect(field.label).toBe(block.label)
    expect(block.label).toBe(summary.label)
    expect(submissions.items.every((item: FixtureRow) => typeof item.data.staff === 'number')).toBe(true)
  })

  it('外部連携の見本は既存の送れる出来事を使い、秘密の鍵や送信結果を変えない', () => {
    const rows = BOARD_STATE_PROFILES.ZSbFY.api[0].body.data
    expect(rows.map((row: FixtureRow) => row.eventTypes[0]).slice(0, 3)).toEqual(['message_received', 'friend_add', 'booking_created'])
    for (const row of rows) {
      expect(row.deliverySummary.total).toBe(row.deliverySummary.succeeded + row.deliverySummary.failed + row.deliverySummary.pending)
    }
    expect(BOARD_STATE_PROFILES.ZSbFY.api.every((rule: FixtureRow) => rule.match.startsWith('GET '))).toBe(true)
  })

  it('月の比較は日本時間の月境界で別のGETを使い、送信済みと一覧総数をそろえる', () => {
    const [current, previous] = BOARD_STATE_PROFILES.MuhWR.api
    expect(current.match).not.toBe(previous.match)
    expect(current.body.data.summary.sent - previous.body.data.summary.sent).toBe(240)
    for (const rule of [current, previous]) {
      const { range, summary, pagination, deliveries } = rule.body.data
      expect(range.from.endsWith('15:00:00.000Z')).toBe(true)
      expect(range.from < range.to).toBe(true)
      expect(pagination.total).toBe(['pending', 'processing', 'sent', 'skipped', 'failed', 'cancelled'].reduce((count, key) => count + summary[key], 0))
      expect(rule.match.startsWith('GET /api/nen-campaigns/deliveries?')).toBe(true)
      for (const row of deliveries) {
        expect(row.scheduledAt >= range.from && row.scheduledAt < range.to).toBe(true)
        if (row.sentAt) expect(row.sentAt >= range.from && row.sentAt < range.to).toBe(true)
      }
    }
  })

  it('予約後の撮影は、存在する予約済み配信を開く', () => {
    const id = new URL(BOARD_STATE_PROFILES.cdZBf.url, 'http://capture.local').searchParams.get('id')
    const broadcast = BROADCASTS.find((row: FixtureRow) => row.id === id)
    expect(broadcast).toBeDefined()
    expect(broadcast.status).toBe('scheduled')
  })

  it('今日のお店は既存の予約ID・日時・人数と別APIを残して、名前と状態を再現する', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `dash-${i}`, customer_name: '見本', source: 'line', status: 'confirmed', table_label: `T${i}`, starts_at: '@TODAY@T17:00:00', ends_at: '@TODAY@T19:00:00', guest_count: 2 }))
    const day = { match: 'GET /api/restaurant-test/reservations/day', body: { success: true, data: { date: '@TODAY@', reservations: rows, closures: [] } } }
    const other = { match: 'GET /api/other', body: { success: true } }
    const input = { boards: { qwIZr: { state: { api: [day, other] } } } }
    const before = structuredClone(input)
    const rules = applyBoardStateProfiles(input).boards.qwIZr.state.api
    expect(input).toEqual(before)
    expect(rules[1]).toEqual(other)
    const updated = rules[0].body.data.reservations
    expect(updated).toHaveLength(5)
    expect(updated.map((row: FixtureRow) => [row.id, row.starts_at, row.ends_at, row.guest_count])).toEqual(rows.slice(0, 5).map(row => [row.id, row.starts_at, row.ends_at, row.guest_count]))
    expect(updated[0].status).toBe('visited')
    expect(updated[2].status).toBe('pending')
    expect(updated[4].status).toBe('pending')
    expect(updated[4].hold_expires_at).toBeTruthy()
    expect(updated.slice(0, 4).every((row: FixtureRow) => row.hold_expires_at === null)).toBe(true)
  })

})
