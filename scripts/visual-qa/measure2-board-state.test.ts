import { describe, expect, it } from 'vitest'
// @ts-expect-error 撮影用スクリプトは素のJS。
import { applyBoardStateProfiles, BOARD_STATE_PROFILES } from './measure2-board-state.mjs'
// @ts-expect-error 共通の見本も素のJS。
import { RICH_MENU_GROUP_DETAILS } from './fixtures.mjs'

describe('板ごとの撮影条件', () => {
  it('普通のリッチメニュー一覧の見本だけを4行にし、元のAPIと見本を保持する', () => {
    const account = { match: 'GET /api/line-accounts$', body: { success: true, data: [] } }
    const input = { boards: { rZEGN: { url: '/rich-menus', state: { api: account } } } }
    const before = structuredClone(input)
    const result = applyBoardStateProfiles(input)
    expect(input).toEqual(before)
    const rules = result.boards.rZEGN.state.api
    expect(rules.at(-1)).toEqual(account)
    const groups = rules.find(rule => rule.match === 'GET /api/rich-menu-groups$').body.data
    expect(groups.total).toBe(groups.items.length)
    expect(groups.facets.published).toBe(groups.items.filter(group => group.status === 'published').length)
    expect(groups.items.some(group => group.id === 'rich-menu-safe')).toBe(false)
    expect(groups.items.find(group => group.id === 'rmg-autumn').publishingAt > new Date().toISOString()).toBe(true)
  })
  it('作成状態は保存や本文入力をせず、開く操作だけで再現する', () => {
    const clicks = Object.values(BOARD_STATE_PROFILES).flatMap(profile => profile.click ?? [])
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
    const rows = rules.find(rule => rule.match === 'GET /api/hq/templates$')!.body.data
    const folders = rules.find(rule => rule.match === 'GET /api/hq/templates/folders$')!.body.data
    expect(rows).toHaveLength(size as number)
    expect(rows.every(row => row.template_type === type)).toBe(true)
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
    for (const row of rows) {
      expect(row.distributed_account_count).toBe(row.distributed_account_names.length)
      if (row.folder_id) expect(folders.some(folder => folder.id === row.folder_id)).toBe(true)
    }
    expect(rules.every(rule => rule.match.startsWith('GET '))).toBe(true)
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
    expect(new Set(data.items.map(item => item.id)).size).toBe(8)
    expect(data.items[0].pet_name).toBe('こむぎちゃん')
    expect(data.items[1].hide_owner_name).toBe(0)
    expect(data.items.every(item => item.view_count_30_days == null)).toBe(true)
  })

  it('一括配信の撮影は送れた数を対象数以下に保ち、フォルダの数を現物から数える', () => {
    const profile = BOARD_STATE_PROFILES.U4Eep0
    const rows = profile.api[0].body.data
    const folders = profile.api[1].body.data
    expect(rows).toHaveLength(24)
    expect(rows.some(row => row.targets.every(target => target.status === 'sent'))).toBe(true)
    expect(rows.some(row => row.status === 'prepared')).toBe(true)
    for (const row of rows) for (const target of row.targets) {
      expect(target.successCount).toBeLessThanOrEqual(target.totalCount)
      expect(target.excluded).toBe(false)
    }
    for (const folder of folders) expect(folder.item_count).toBe(rows.filter(row => row.input.folderId === folder.id).length)
    expect(profile.api.every(rule => rule.match.startsWith('GET '))).toBe(true)
  })

  it('公開のつながりを撮っても、編集の下書きは公開状態にしない', () => {
    const group = BOARD_STATE_PROFILES.wxIQ7.api[0].body.data
    expect(group.status).toBe('published')
    expect(group.pages.every(page => Boolean(page.lineRichmenuId))).toBe(true)
    expect(RICH_MENU_GROUP_DETAILS['rmg-1'].status).toBe('draft')
  })

  it('解約のお知らせは設定・定義・集計が同じ解約イベントを指す', () => {
    const rules = BOARD_STATE_PROFILES.g3iDs.api
    const settings = rules[0].body.data
    const definition = rules[1].body.data.find(row => row.name === '定期便を止めた')
    expect(definition.sourceEventType).toBe('ec.subscription.cancelled')
    expect(settings.find(row => row.label === definition.name).eventType).toBe(definition.sourceEventType)
    expect(rules[2].body.data.byEventType.some(row => row.eventType === definition.sourceEventType)).toBe(true)
  })
})
