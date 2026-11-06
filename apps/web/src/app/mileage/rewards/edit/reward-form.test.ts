import { describe, expect, it } from 'vitest'
import { readUiSource as readFileSync } from '../../../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'

import { optionalInteger, validateReward, type FormState } from './reward-form'

const RAW_PAGE = readFileSync(join(__dirname, 'v8-reward-edit.tsx'), 'utf8')

/**
 * 注釈を落とす。**見張りたいのは画面に出る言葉だけ。**
 * 「なぜ出さないか」を書いた注釈が自分の見張りに当たると、
 * 直してあるのに落ちるという嘘の失敗になる。
 */
const PAGE = RAW_PAGE
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

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
  targetConditions: null,
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

  it('R298: 空欄は無制限・0は品切れ・正の整数は上限、それ以外は止める', () => {
    // 在庫だけは 0 が品切れの意味を持つ（R299）。それ以外は 1 以上。
    expect(validateReward({ ...base, stockLimit: '0' })).toEqual([])
    expect(validateReward({ ...base, stockLimit: '10' })).toEqual([])
    // 全角数字は半角へそろえて受け取る。
    expect(validateReward({ ...base, stockLimit: '１０' })).toEqual([])
    expect(optionalInteger('１０')).toBe(10)

    for (const key of ['stockLimit', 'perFriendLimit', 'benefitExpiresDays'] as const) {
      for (const bad of ['abc', '-1', '1.5']) {
        expect(validateReward({ ...base, [key]: bad }).length, `${key}=${bad}`).toBeGreaterThan(0)
      }
      expect(validateReward({ ...base, [key]: '' }), `${key}=空欄`).toEqual([])
      expect(validateReward({ ...base, [key]: '5' }), `${key}=5`).toEqual([])
    }
    // 0 が通るのは数の限りだけ。
    expect(validateReward({ ...base, perFriendLimit: '0' })).toContain('1人あたりの上限は1以上の整数で入力してください')
    expect(validateReward({ ...base, benefitExpiresDays: '0' })).toContain('交換後に使える日数は1以上の整数で入力してください')
    // 不正な入力は undefined を返し、null（無制限）にはならない。
    expect(optionalInteger('abc')).toBeUndefined()
    expect(optionalInteger('')).toBeNull()
  })
})

/*
 * 画面の配線（数の限りの保存・欄ごとの止め方・選べる種類・版つき保存・確認後の公開・
 * 壊れた1件取得・共通アクションの公開版・交換対象の条件）は、本物の React で押して
 * 確かめる reward-edit-react.test.tsx が守る。ここには「書いてはいけない形」だけを残す。
 */
describe('管理画面 17-1-G で書いてはいけない形', () => {
  it('数の限りの 0・数にならない入力を null（無制限）へ潰さない', () => {
    expect(PAGE).not.toContain('Number(value) || null')
    expect(PAGE).not.toContain('Number.isFinite(parsed) ? parsed : null')
  })

  it('保存できない渡すものの種類を出さない', () => {
    /*
      設計には「回答フォームへ」「品もの」もあるが、`MileageRewardKind` に
      無い。出すと**選べるように見えて保存できない。**
    */
    expect(PAGE).not.toContain('回答フォームへ')
    expect(PAGE).not.toContain('品もの')
  })

  it('内部の記号を画面に出さない', () => {
    // 種類の値（`coupon` など）は選択肢の value にだけ置き、文字として出さない。
    expect(PAGE).not.toMatch(/>\s*(coupon|early_access|failurePolicy)\s*</)
    // 強調の記号は画面にそのまま出るので書かない。
    expect(PAGE).not.toMatch(/\*\*[^*\n]+\*\*[^\n]*<\/NoteBar>/)
  })

  it('共通アクションは版の手入力や下書きの読み込みに戻さない', () => {
    expect(PAGE).not.toContain('api.commonActions.get(item.id')
    expect(PAGE).not.toContain('placeholder="共通アクションの版"')
  })
})
