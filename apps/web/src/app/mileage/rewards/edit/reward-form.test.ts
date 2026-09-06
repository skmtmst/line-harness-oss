import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { validateReward, type FormState } from './reward-form'

const RAW_PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')
const API = readFileSync(join(__dirname, '..', '..', '..', '..', 'lib', 'api.ts'), 'utf8')

/**
 * 注釈を落とす。**見張りたいのは画面に出る言葉だけ。**
 * 「なぜ出さないか」を書いた注釈が自分の見張りに当たると、
 * 直してあるのに落ちるという嘘の失敗になる。
 */
const PAGE = RAW_PAGE
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
const LIST = readFileSync(join(__dirname, '..', '..', 'mileage-rewards-tab.tsx'), 'utf8')

const base: FormState = {
  name: '送料無料クーポン',
  description: '',
  rewardKind: 'coupon',
  requiredMiles: '1000',
  stockLimit: '',
  perFriendLimit: '',
  startsAt: '',
  endsAt: '',
  benefitExpiresDays: '',
  commonActionVersionId: '',
  failurePolicy: 'retry',
  customerMessage: '',
}

/** マイルの使い道をつくる・編集する（設計 `p9CcEB` 17-1-G）。 */
describe('使い道の入力の確かめ', () => {
  it('名前と必要マイルが要る', () => {
    expect(validateReward({ ...base, name: '  ' })).toContain('使い道の名前を入力してください')
    expect(validateReward({ ...base, requiredMiles: '' })).toContain('必要マイルは1以上の整数で入力してください')
    expect(validateReward({ ...base, requiredMiles: '0' })).toContain('必要マイルは1以上の整数で入力してください')
  })

  it('クーポン以外は渡すものが要る', () => {
    /*
      Worker の `action_required` と同じ。**画面で先に気づけるだけ**で、
      Worker の検査を置き換えるものではない。
    */
    expect(validateReward({ ...base, rewardKind: 'tag' })).toContain('交換後に渡すものを選んでください')
    expect(validateReward({ ...base, rewardKind: 'tag', commonActionVersionId: 'cav-1' })).toEqual([])
    // クーポンは選ばなくても出せる。
    expect(validateReward(base)).toEqual([])
  })

  it('交換の終わりは始まりより後', () => {
    expect(validateReward({ ...base, startsAt: '2026-09-10T10:00', endsAt: '2026-09-01T10:00' }))
      .toContain('交換終了は交換開始より後にしてください')
  })
})

describe('V6 17-1-G の配線', () => {
  it('数の限りで「限りなし」と「品切れ」を混ぜない', () => {
    /*
      **空欄は限りなし、0 は品切れ。** 同じ扱いにすると、出したつもりの
      ものが誰にも交換できない状態を見分けられない。
    */
    expect(PAGE).toContain('空欄なら限りなし。0 と書くと品切れ（交換できません）')
    expect(PAGE).toContain("if (!trimmed) return null")
    // 0 を null へ潰さない。
    expect(PAGE).not.toContain('Number(value) || null')
  })

  it('渡すものは保存できる種類だけ出す', () => {
    /*
      設計には「回答フォームへ」「品もの」もあるが、`MileageRewardKind` に
      無い。出すと**選べるように見えて保存できない。**
    */
    for (const kind of ['coupon', 'tag', 'scenario', 'template', 'early_access', 'rank']) {
      expect(PAGE).toContain(`value: '${kind}'`)
    }
    expect(PAGE).not.toContain('回答フォームへ')
    expect(PAGE).not.toContain('品もの')
  })

  it('渡せなかったときの決めごとを画面から選べる', () => {
    for (const label of ['もう一度試す（おすすめ）', 'マイルを返す', '担当者が手で対応する']) {
      expect(PAGE).toContain(label)
    }
  })

  it('既存の使い道は版IDつきで更新し、確認後だけ公開する', () => {
    expect(PAGE).toContain('currentDraftVersionId')
    expect(PAGE).toContain('createRewardDraft')
    expect(PAGE).toContain('<ConfirmDialog')
    expect(API).toContain("method: 'PATCH'")
    expect(API).toContain('expectedVersionId')
    expect(API).toContain("'X-Confirm-Irreversible': 'mileage-reward-publish'")
  })

  it('保存した下書きを、残高と在庫を動かさず交換テストする', () => {
    expect(PAGE).toContain('自分で交換をテスト')
    expect(PAGE).toContain('api.mileage.testReward(saved.id, selectedAccountId)')
    expect(PAGE).toContain('残高と在庫は動かしていません')
    expect(API).toContain('/api/mileage/rewards/${encodeURIComponent(id)}/test')
    expect(API).toContain('ApiResponse<MileageRewardTestResult>')
  })

  it('一覧から行き止まりを作らない', () => {
    expect(LIST).toContain('href="/mileage/rewards/edit"')
    expect(LIST).toContain('使い道をつくる')
    expect(LIST).toContain('内容を編集')
  })

  it('内部の記号を画面に出さない', () => {
    // 種類の値（`coupon` など）は選択肢の value にだけ置き、文字として出さない。
    expect(PAGE).not.toMatch(/>\s*(coupon|early_access|failurePolicy)\s*</)
    // 強調の記号は画面にそのまま出るので書かない。
    expect(PAGE).not.toMatch(/\*\*[^*\n]+\*\*[^\n]*<\/NoteBar>/)
  })
})
