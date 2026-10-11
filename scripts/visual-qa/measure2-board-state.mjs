/** 固定した絵の板IDで、撮影時に開く画面を選ぶ。製品の保存・権限は変えない。 */
export const REFERENCE_REVISION = '2026-10-11 16:11 JST'

const createTemplate = (kind) => ({
  url: '/hq/templates',
  click: [kind, 'テンプレートを作る'],
})

export const BOARD_STATE_PROFILES = {
  iN6np: { url: '/broadcasts/new?step=message&draft=visual-compose' },
  pIHp3: { url: '/hq/broadcasts/new?step=message&id=hq-visual-compose' },
  M2tJM: { url: '/hq/broadcasts/detail?id=hq-visual-sent' },
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
  }
  return result
}

export const FORM_STATE_PROFILES = {
  u5MM7: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit' },
  scJcP: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&tab=after' },
  xRPdo: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&tab=appearance' },
  N4T9mO: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&page=2' },
}
