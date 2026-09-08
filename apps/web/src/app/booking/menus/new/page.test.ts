import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const CREATE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const LIST = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8')
const CREATE_PAGE = readFileSync(
  new URL('../../../../components/shared/create-page.tsx', import.meta.url),
  'utf8',
)
const WORKER_BOOKING = readFileSync(
  new URL('../../../../../../worker/src/routes/booking.ts', import.meta.url),
  'utf8',
)
const TAG_ATTACH = readFileSync(
  new URL('../../../../../../worker/src/services/friend-tag-attach.ts', import.meta.url),
  'utf8',
)

describe('E-03 予約メニュー作成時の自動タグ選択', () => {
  test('対象アカウント内のタグを検索・選択・解除できる', () => {
    // 検索欄とプルダウンは共通部品に寄せる(素の select/input を画面に書かない)
    expect(CREATE).toContain('<SearchField')
    expect(CREATE).toContain('placeholder="タグを検索"')
    expect(CREATE).toContain('onClear={() => setTagQuery(\'\')}')
    expect(CREATE).toContain('<SelectField')
    expect(CREATE).toContain('id="bm-auto-tag"')
    expect(CREATE).toContain("{ value: '', label: '— なし —' }")
    expect(CREATE).toContain('setAutoTagId(e.target.value === \'\' ? null : e.target.value)')
    expect(CREATE).not.toContain('<select')
  })

  test('保存requestへauto_tag_idを送る', () => {
    expect(CREATE).toContain('bookingApi.createMenu(selectedAccountId!, {')
    expect(CREATE).toContain('auto_tag_id: autoTagId,')
  })

  test('別アカウントと整理済みのタグを候補にしない', () => {
    expect(CREATE).toContain('t.lineAccountId === selectedAccountId')
    expect(CREATE).toContain("t.status !== 'archived'")
  })

  test('アカウント切替で前の選択を残さず、候補外のタグを保存対象にしない', () => {
    expect(CREATE).toContain('setAutoTagId(null)')
    expect(CREATE).toContain('}, [selectedAccountId])')
    expect(CREATE).toContain('選んだタグは使えなくなりました。選び直すか「なし」にしてください')
    // 保存側の境界検証(#504-5の直し済み)と二重化する
    expect(WORKER_BOOKING).toContain('SELECT 1 FROM tags WHERE id = ? AND line_account_id = ?')
    expect(WORKER_BOOKING).toContain("return c.json({ error: 'tag_not_found' }, 400)")
  })

  test('読込・空・失敗でも誤保存や入力消失を起こさない', () => {
    expect(CREATE).toContain("tagLoadState, setTagLoadState] = useState<'loading' | 'ready' | 'error'>")
    expect(CREATE).toContain('タグを読み込んでいます…')
    expect(CREATE).toContain('タグを読み込めませんでした。タグなしで保存できます。')
    expect(CREATE).toContain('このアカウントに使えるタグがありません。タグなしで保存できます。')
    // 検索で選んだタグが隠れても選択は残す
    expect(CREATE).toContain('const tagOptions = selectedTag != null')
    // 保存失敗は入力を残して選び直せる(成功時だけ初期化する)
    expect(CREATE).toContain('選んだタグは削除されたため保存できませんでした。タグを選び直してください。')
    expect(CREATE).toContain('setAutoTagId(null)')
  })

  test('保存中の二重送信を起こさない', () => {
    expect(CREATE_PAGE).toContain('if (saving) return')
    expect(CREATE_PAGE).toContain("disabled={saving}")
  })

  test('保存後に再表示で同じタグが確認できる', () => {
    // 一覧取得が auto_tag_id を返し、編集窓が同じ値を表示する
    expect(WORKER_BOOKING).toContain('m.sort_order, m.is_active, m.auto_tag_id,')
    expect(WORKER_BOOKING).toContain('auto_tag_id: row.auto_tag_id,')
    expect(LIST).toContain("value={form.auto_tag_id ?? ''}")
  })

  test('結合契約: タグ設定済みメニューの予約完了で一度だけタグが付き、再送で二重副作用がない', () => {
    // 予約完了時にメニューの自動タグを付ける
    expect(WORKER_BOOKING).toContain('if (menuRow.auto_tag_id) {')
    expect(WORKER_BOOKING).toContain('attachTagAndFireSideEffects(c.env.DB, friendId, tagId, {')
    // 付与は INSERT OR IGNORE で、新規のときだけ副作用(シナリオ・イベント)を打つ
    expect(TAG_ATTACH).toContain('INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)')
    expect(TAG_ATTACH).toContain('if (!added) return { added: false }')
    // 同じ Idempotency-Key の再送は保存済み応答を返し、予約もタグ付与も再実行しない
    expect(WORKER_BOOKING).toContain('const cached = await findIdempotencyResponse(c.env.DB, {')
    expect(WORKER_BOOKING).toContain('if (cached) {')
  })
})
