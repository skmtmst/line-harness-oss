import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PART = readFileSync(join(HERE, 'webinar-notifications.tsx'), 'utf8')
const EDIT = readFileSync(join(HERE, '..', '..', 'app', 'webinars', 'edit', 'page.tsx'), 'utf8')
const STEPS = readFileSync(join(HERE, '..', '..', 'app', 'webinars', 'edit', 'edit-steps.ts'), 'utf8')

/**
 * ウェビナーの通知・リマインド（設計 `Ho8z4` 10-1-D）。
 *
 * **5 つの通知はそれぞれ別の目的を持つ。** まとめて「通知する／しない」に
 * すると、申込のお礼だけ止めたいときに前日・当日まで止まる。
 */
describe('通知の設定', () => {
  it('通知を1つずつ切れる', () => {
    for (const key of [
      'registrationEnabled',
      'dayBeforeEnabled',
      'hourBeforeEnabled',
      'startEnabled',
      'missedEnabled',
      'completedEnabled',
    ]) {
      expect(PART, `${key} を切り替えられない`).toContain(`${key}: !settings.${key}`)
    }
  })

  it('切っている通知の細かい設定を出さない', () => {
    /* 押しても効かない欄を並べると、設定したつもりで送られない。 */
    expect(PART).toContain('{row.on && row.extra ? <div className="shrink-0">{row.extra}</div> : null}')
  })

  it('素の選び口を使わない', () => {
    /* 設計の選び口（`rpot9` / `Gfsb4`）にそろえる。 */
    expect(PART).toContain("import Select from '@/components/shared/select'")
  })
})

/**
 * 送った結果。**設定だけ見ても、実際に届いたかは分からない。**
 */
describe('送った結果の数', () => {
  it('待ち・送信済み・失敗・見送り・取消を分けて出す', () => {
    for (const label of ['予定', '送信済み', '失敗', '見送り', '取消', '合計']) {
      expect(PART, `${label} が無い`).toContain(`'${label}'`)
    }
  })

  it('読めていないときに 0 件と書かない', () => {
    /* 「失敗 0 件」と「まだ数えていない」を混ぜない。 */
    expect(PART).toContain('const available = overview !== null')
    expect(PART).toContain("countText(value as number | undefined, available)")
    expect(PART).toContain('送った結果はまだ読めていません。—（未取得）')
  })

  it('数が無いときは単位も出さない', () => {
    /* `—件` は数に見える。 */
    expect(PART).toContain('{available && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}')
  })

  it('保存したとき、何が起きたかを数で言う', () => {
    /* 「保存しました」だけでは、予定が積まれたのか取り消されたのか分からない。 */
    expect(PART).toContain('件を予定に入れ、')
    expect(PART).toContain('件を取り消しました。')
  })

  it('通知対象は実人数と延べ予約を分けて表示する', () => {
    expect(PART).toContain('audienceText(overview?.audience)')
    expect(PART).toContain('通知の対象')
    expect(PART).toContain('{audience.people}')
    expect(PART).toContain('{audience.note}')
  })
})

describe('読めなかったとき', () => {
  it('形が違う返事を、そのまま画面へ流さない', () => {
    /* 器だけ違うものが来ると `settings.dayBeforeTime` で落ち、白い画面になる。 */
    expect(PART).toContain("if (!res.data || typeof res.data !== 'object') throw new Error('shape')")
  })

  it('読込・失敗・未設定を1枚ずつ言い分ける', () => {
    expect(PART).toContain("import ListState from '@/components/shared/list-state'")
    for (const kind of ['loading', 'error', 'empty']) {
      expect(PART, `${kind} の1枚が無い`).toContain(`kind="${kind}"`)
    }
    /* まだ設定が無いのと、読めなかったのは別のこと。 */
    expect(PART).toContain('title="通知の設定がまだありません"')
    expect(PART).toContain('title="通知の設定を読み込めませんでした"')
  })
})

describe('編集画面の STEP 4', () => {
  it('段の中身が「まだ繋がっていません」から実物へ変わった', () => {
    expect(EDIT).toContain('<WebinarNotifications webinarId={webinar.id} />')
    expect(STEPS, '未接続の印が残っている').not.toContain("notConnected: '通知・リマインドの設定'")
  })
})
