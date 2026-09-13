import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const API = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'api.ts'), 'utf8')
const ERROR_TEXT = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'components', 'webinars', 'webinar-error-text.ts'),
  'utf8',
)
const WORKER = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', '..', 'worker', 'src', 'routes', 'webinars.ts'),
  'utf8',
)

describe('N-113 ウェビナーの申込フォーム選択の契約', () => {
  it('同一アカウントの公開中フォームだけを候補にする', () => {
    /* 口は account_id で絞る。別アカウントは器の段階で混ざらない。 */
    expect(PAGE).toContain('/api/forms?account_id=')
    /* 停止中は候補から外す（公開中だけ）。 */
    expect(PAGE).toContain('publishedRegistrationForms')
    expect(PAGE).toContain('.filter((form) => form.isActive)')
    /* 判定材料の isActive を口の型に含める。 */
    expect(API).toContain('isActive: boolean')
  })

  it('読込中・0件・取得失敗・権限不足を区別し再試行できる', () => {
    expect(PAGE).toContain("'loading' | 'ready' | 'error' | 'forbidden'")
    expect(PAGE).toContain('回答フォームを読み込んでいます。')
    expect(PAGE).toContain('公開中の回答フォームがありません。')
    expect(PAGE).toContain('回答フォームを読み込めませんでした。')
    expect(PAGE).toContain('回答フォームを見る権限がありません。')
    /* 403・404 は権限不足、それ以外は取得失敗。 */
    expect(PAGE).toContain('cause.status === 403 || cause.status === 404')
    expect(PAGE).toContain('もう一度読み込む')
  })

  it('選択値を registration_form_id として保存し再読込後も復元する', () => {
    /* 保存は版付きの editor 口へ registrationFormId として送る。 */
    expect(PAGE).toContain('webinarApi.saveEditor(webinarId')
    expect(PAGE).toContain('registrationFormId: selectedRegistrationFormId || null')
    expect(PAGE).toContain('expectedVersion: editor.version')
    /* 保存結果を親の editor へ流し、表示中の版を更新する。 */
    expect(PAGE).toContain('onEditorChange(response.data)')
    /* 開き直し時は保存済みの registrationFormId を初期値にする。 */
    expect(PAGE).toContain('useState<string>(editor.registrationFormId ??')
    /* 二重保存を防ぐ。 */
    expect(PAGE).toContain('disabled={savingRegistrationForm')
    expect(PAGE).toContain('保存中…')
  })

  it('停止・削除・別アカウントは拒否理由を表示し選び直しを促す', () => {
    /* サーバーの拒否コードを受けて候補を取り直す。 */
    expect(PAGE).toContain('form_inactive_or_missing')
    expect(PAGE).toContain('form_account_mismatch')
    expect(PAGE).toContain('loadRegistrationForms()')
    /* 理由文は共通の日本語化を通す。 */
    expect(PAGE).toContain('webinarErrorText(cause,')
    expect(ERROR_TEXT).toContain('form_inactive_or_missing')
    expect(ERROR_TEXT).toContain('form_account_mismatch')
    /* 候補に無い選択・保存済みには警告を出す。 */
    expect(PAGE).toContain('前に選んだフォームは使えなくなりました')
    expect(PAGE).toContain('保存済みの申込フォームは公開中ではありません')
    expect(PAGE).toContain('role="alert"')
  })

  it('選択→保存→再読込→公開前確認の一連の流れがつながる', () => {
    /* 保存済みの表示は editor の公開フォーム詳細から描く。 */
    expect(PAGE).toContain('editor.publicPage.form')
    /* 公開前確認は公開フォームの有効状態を見る。 */
    expect(PAGE).toContain('webinarApi.publishValidation(webinar.id)')
    expect(WORKER).toContain("key: 'form_active'")
    /* 保存後の案内で公開前確認へ誘導する。 */
    expect(PAGE).toContain('公開前確認で申込フォーム')
  })

  it('CTA内のフォームと申込フォームを混同しない', () => {
    /* CTA側は CTA カードの formId のまま。 */
    expect(PAGE).toContain('primary?.formId')
    /* 申込側は registrationFormId のまま。別名で扱う。 */
    expect(PAGE).toContain('selectedRegistrationFormId')
    expect(PAGE).toContain('editor.registrationFormId')
    /* 画面の説明文でも別物だと書く。 */
    expect(PAGE).toContain('CTAボタンで使うフォームとは別です')
  })

  it('外部への送信を足さない（保存と取得だけ）', () => {
    /* この段の送信先は editor の保存だけ。LINE・顧客・カレンダーへ送らない。 */
    expect(PAGE).toContain('webinarApi.saveEditor(webinarId')
    expect(PAGE).not.toContain('/api/meet-consultations')
    expect(PAGE).not.toContain('X-Line-Harness-Source')
  })
})
