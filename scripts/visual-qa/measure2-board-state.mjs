/** 固定した絵の板IDで、撮影時に開く画面を選ぶ。製品の保存・権限は変えない。 */
import { RICH_MENU_GROUPS, TAGS } from './fixtures.mjs'

export const REFERENCE_REVISION = '2026-10-11 16:11 JST'

const createTemplate = (kind) => ({
  url: '/hq/templates',
  click: [kind, 'テンプレートを作る'],
})

// 普通の一覧の撮影だけを4行にする。削除確認で使う未使用の下書きは共通見本に残す。
const richMenuItems = RICH_MENU_GROUPS.filter(group => group.id !== 'rich-menu-safe').map(group => ({
  ...group,
  ...(group.id === 'rmg-gold' ? { audienceCount: 182 } : {}),
  // 10/5の予約が撮影日を過ぎても、予約状態の絵を再現する。
  ...(group.id === 'rmg-autumn' ? { publishingAt: `${new Date().getUTCFullYear() + 1}-10-05T00:00:00.000+09:00` } : {}),
})).sort((a, b) => a.targetingPriority - b.targetingPriority)
const richMenuApi = [
  { match: 'GET /api/rich-menu-groups$', body: { success: true, data: {
    items: richMenuItems, total: richMenuItems.length, limit: 20,
    sort: [{ field: 'targetingPriority', direction: 'asc' }, { field: 'createdAt', direction: 'asc' }, { field: 'id', direction: 'asc' }],
    facets: { total: richMenuItems.length, published: richMenuItems.filter(group => group.status === 'published').length, targeting: richMenuItems.filter(group => group.targetingEnabled).length, folderCounts: Object.fromEntries(richMenuItems.reduce((counts, group) => {
      const id = group.folderId ?? '__unfiled__'; counts.set(id, (counts.get(id) ?? 0) + 1); return counts
    }, new Map())) },
  } } },
  { match: 'GET /api/tags$', body: { success: true, data: TAGS.map(tag => tag.id === 'tag-0' ? { ...tag, name: 'ゴールド会員' } : tag) } },
]

export const BOARD_STATE_PROFILES = {
  rZEGN: { url: '/rich-menus', api: richMenuApi },
  HfK0O: createTemplate('メッセージ'),
  SDSsr: createTemplate('カルーセル'),
  IY3nx: createTemplate('質問'),
  C3qMCz: createTemplate('クーポン'),
  Fkv3w: createTemplate('リサーチ'),
  g8d6ai: createTemplate('リッチメッセージ'),
  Ni0V8: createTemplate('リッチビデオ'),
  pQ4fH: { url: '/hq/templates?item=visual-hq-tpl-thanks&mode=detail' },
}

export function applyBoardStateProfiles(map) {
  const result = structuredClone(map)
  if (!result.boards || typeof result.boards !== 'object') throw new Error('boards を持つ対応表を指定してください')
  for (const [id, profile] of Object.entries(BOARD_STATE_PROFILES)) {
    const entry = result.boards[id]
    if (!entry) continue
    // 閲覧のみ・失敗・手動の再現条件がある板を、作成画面の見本で上書きしない。
    if (entry.state?.manual || entry.state?.role === 'viewer' || entry.kind === '閲覧のみ' || entry.state?.click) {
      throw new Error(`${id}: 既存の状態指定と撮影の指定が重なっています`)
    }
    entry.url = profile.url
    if (profile.click) entry.state = { ...entry.state, click: [...profile.click] }
    if (profile.api) entry.state = { ...entry.state, api: [...profile.api, ...(Array.isArray(entry.state?.api) ? entry.state.api : entry.state?.api ? [entry.state.api] : [])] }
  }
  return result
}

export const FORM_STATE_PROFILES = {
  u5MM7: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit' },
  scJcP: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&tab=after' },
  xRPdo: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&tab=appearance' },
  N4T9mO: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&page=2' },
}
