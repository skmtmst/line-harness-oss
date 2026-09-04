import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const FORM = fs.readFileSync(path.join(__dirname, 'webinar-form.tsx'), 'utf8')
const DONE = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'webinars', 'published', 'page.tsx'), 'utf8')

describe('V6 ウェビナー公開前確認と公開完了の契約', () => {
  it('下書きから公開へ変えるときだけ確認を挟む', () => {
    expect(FORM).toContain("const isPublishing = status === 'active' && initial?.status !== 'active'")
    expect(FORM).toContain('<ConfirmDialog')
    /*
      題は**ウェビナーの名前**を出す。「このウェビナーを」だと、2枚開いて
      いるときにどちらを公開するのか読めない（削除の窓 `EGMb1` と同じ形）。
    */
    expect(FORM).toContain("title={`「${title || '無題のウェビナー'}」を公開しますか？`}")
    expect(FORM).toContain('この内容で公開する')
    expect(FORM).toContain('onClick={requestSave}')
  })

  it('動画・配信枠・動画時間が無い状態では公開させない', () => {
    expect(FORM).toContain("if (!videoPrefix.trim())")
    expect(FORM).toContain('if (rules.length === 0)')
    expect(FORM).toContain('durationMinutes < 1')
    expect(FORM.indexOf('const problem = publicationProblem()')).toBeLessThan(FORM.indexOf('setPublishConfirmOpen(true)'))
  })

  it('公開APIの実際の返事に含まれるIDだけを完了画面へ渡す', () => {
    expect(FORM).toContain('`/webinars/published?id=${updated.data.id}`')
    expect(FORM).toContain('`/webinars/published?id=${created.data.id}`')
    expect(FORM).not.toContain('/webinars/published?status=success')
  })

  it('公開完了は実Nodeと実データだけを表示する', () => {
    expect(DONE).toContain('data-design-node="TimXl"')
    expect(DONE).toContain("webinarApi.get(id)")
    expect(DONE).toContain("webinar.status !== 'active'")
    expect(DONE).toContain('{webinar.schedule.length}件')
    expect(DONE).not.toContain('申込 1,284')
    expect(DONE).not.toContain('<Header')
  })

  it('所属アカウントのLIFFが取れたときだけ公開ページを出す', () => {
    expect(DONE).toContain('accounts.find((account) => account.id === webinar.accountId)')
    expect(DONE).toContain('webinarAccount?.liffId')
    expect(DONE).toContain('{publicUrl ? (')
    expect(DONE).toContain('LIFF IDを確認できないため')
  })

  it('読込・失敗・公開状態不一致を完了と混ぜない', () => {
    expect(DONE).toContain('<ListState kind="loading"')
    expect(DONE).toContain('kind="error"')
    expect(DONE).toContain('公開状態を確認できませんでした')
    expect(DONE).toContain('もう一度読み込む')
  })
})
