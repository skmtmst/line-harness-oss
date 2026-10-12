/** 固定した絵の板IDで、撮影時に開く画面を選ぶ。製品の保存・権限は変えない。 */
import { TAG_EDIT_GROUPS, FRIEND_ATTRIBUTE_SAVED_SEARCH_DETAIL } from './fixtures.mjs'
export const REFERENCE_REVISION = '2026-10-11 16:11 JST'

const createTemplate = (kind) => ({
  url: '/hq/templates',
  click: [kind, 'テンプレートを作る'],
})

const searchEditExample = structuredClone(FRIEND_ATTRIBUTE_SAVED_SEARCH_DETAIL)
// 「VIPかつ未契約」：2つ目は付いていないタグを選ぶ。共通の一覧見本は変えない。
searchEditExample.conditions.all[1].op = 'excludes'

export const BOARD_STATE_PROFILES = {
  AqDWN: { url: '/tags/searches/edit?id=ss-1', api: { match: 'GET /api/saved-searches/ss-1$', body: { success: true, data: searchEditExample } } },
  l87p1J: { url: '/templates/questions/new', click: ['fill:テンプレート名=定期便 継続のご確認', 'fill:前文（空なら送らない）=いつもありがとうございます。', 'fill:質問文（160文字まで）=来月も定期便を続けますか？', '押されたときにあわせて行うことを足す', 'fill:選択肢1の足すスコア=10', '名前とフォルダ'] },
  K7HWG: { url: '/auto-replies/edit?id=ar-new', click: ['fill:ルール名='] },
  d4adD4: { url: '/events/new', click: ['fill:イベント名=秋のしつけ教室（第1回）', '1人あたりの予約回数', '1 回まで', '申し込みの上限', '開始の 1 日前まで', '承認', '承認してから確定（期限 24 時間）', '満席になったとき', 'キャンセル待ちを受ける（空いたら順番に案内）', '＋ 質問を足す', 'fill:聞くこと=ペットの名前と年齢', '足す'] },
  Qat9s: { url: '/tags/edit?id=tag-ec-customer', api: { match: 'GET /api/tag-groups$', body: { success: true, data: TAG_EDIT_GROUPS } } },
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
    if (profile.api && entry.state?.api) throw new Error(`${id}: 既存のAPI指定と撮影の指定が重なっています`)
    entry.url = profile.url
    if (profile.click) entry.state = { ...entry.state, click: [...profile.click] }
    if (profile.api) entry.state = { ...entry.state, api: structuredClone(profile.api) }
  }
  return result
}

export const FORM_STATE_PROFILES = {
  u5MM7: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit' },
  scJcP: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&tab=after' },
  xRPdo: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&tab=appearance' },
  N4T9mO: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&page=2' },
}
