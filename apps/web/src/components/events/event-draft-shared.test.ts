import { EVENT_DEFAULT_DRAFT as CREATE_DEFAULT_DRAFT,ENTRY_CUTOFF_OPTIONS,jstDay,jstTime } from '@/v8/events/shared'
import { dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe,expect,it } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatJpDateTime } from '@/v8/events/edit-format'
import {
EVENT_CANCEL_DEADLINE_OPTIONS,
EVENT_DEFAULT_DRAFT,
EVENT_DESCRIPTION_MAX_LENGTH,
EVENT_ENTRY_CUTOFF_OPTIONS,
EVENT_NAME_MAX_LENGTH,
deadlineOptionsWithSaved,
deadlineSelectValue,
parseDeadlineSelect,
resolveEventMultiAccountIds,
} from './event-draft-shared'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')
const FORM = read('..', '..', 'v8', 'events', 'edit-form.tsx')
const CREATE = read('..', '..', 'v8', 'events', 'create.tsx')
const LIST_PAGE = readFileSync(join(HERE, '..', '..', 'v8', 'events', 'list.tsx'), 'utf8')
const BOOKINGS_PAGE = readFileSync(join(HERE, '..', '..', 'v8', 'events', 'bookings.tsx'), 'utf8')
const EDIT_PAGE = readFileSync(join(HERE, '..', '..', 'app', 'events', 'edit', 'page.tsx'), 'utf8')

/**
 * 作成と編集の乖離防止（#740）。UI体験（タブ／段階）は別々のまま置き、
 * ずれたら挙動が食い違う契約（既定値・上限・multi対象）だけを共有する。
 */
describe('イベント作成・編集の共有契約(#740)', () => {
  it('multi の保存対象は現アカウントを必ず含め、重複を除く（サーバの multi 契約を満たす）', () => {
    // 空のまま送るとサーバが 422 invalid_account_ids で止める。
    expect(resolveEventMultiAccountIds({ target_type: 'multi-account-dedup', account_ids: null }, 'a1'))
      .toEqual(['a1'])
    expect(resolveEventMultiAccountIds({ target_type: 'multi-account-dedup', account_ids: [] }, 'a1'))
      .toEqual(['a1'])
    // 入っている分は順番を保ち、現アカウントが無ければ先頭へ足す。
    expect(resolveEventMultiAccountIds({ target_type: 'multi-account-dedup', account_ids: ['a2', 'a1'] }, 'a1'))
      .toEqual(['a2', 'a1'])
    expect(resolveEventMultiAccountIds({ target_type: 'multi-account-dedup', account_ids: ['a2'] }, 'a1'))
      .toEqual(['a1', 'a2'])
    expect(resolveEventMultiAccountIds({ target_type: 'multi-account-dedup', account_ids: ['a1', 'a1'] }, 'a1'))
      .toEqual(['a1'])
    // 文字列で来た古い形も読む。壊れた文字は空とみなして現アカウントだけにする。
    expect(resolveEventMultiAccountIds({ target_type: 'multi-account-dedup', account_ids: '["a2"]' }, 'a1'))
      .toEqual(['a1', 'a2'])
    expect(resolveEventMultiAccountIds({ target_type: 'multi-account-dedup', account_ids: '壊れた文字' }, 'a1'))
      .toEqual(['a1'])
  })

  it('single のときは送らない（既存挙動を変えない）', () => {
    expect(resolveEventMultiAccountIds({ target_type: 'single', account_ids: ['a2'] }, 'a1')).toBeNull()
    expect(resolveEventMultiAccountIds({}, 'a1')).toBeNull()
  })

  it('返す値はサーバの multi 契約（非空の文字配列）を満たす', () => {
    const ids = resolveEventMultiAccountIds({ target_type: 'multi-account-dedup', account_ids: null }, 'a1')
    expect(Array.isArray(ids)).toBe(true)
    expect(ids!.length).toBeGreaterThan(0)
    expect(ids!.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  })

  it('上限値はサーバと同じ数（名前255・詳細20000）', () => {
    expect(EVENT_NAME_MAX_LENGTH).toBe(255)
    expect(EVENT_DESCRIPTION_MAX_LENGTH).toBe(20000)
  })

  it('作成・編集の両方で承認期限2/24/72時間と版競合を同じ契約で送る', () => {
    expect(EVENT_DEFAULT_DRAFT.approval_deadline_hours).toBe(24)
    for (const source of [FORM]) {
      expect(source).toContain('approval_deadline_hours')
      expect(source).toContain("{ value: '2', label: '申込から2時間' }")
      expect(source).toContain("{ value: '24', label: '申込から24時間' }")
      expect(source).toContain("{ value: '72', label: '申込から72時間' }")
      expect(source).toContain('options={APPROVAL_DEADLINE_OPTIONS}')
      expect(source).toMatch(/eventsApi\.updateEvent\([\s\S]*?draft\.version \?\? 1/)
      expect(source).toContain("e.status === 409 && e.code === 'version_conflict'")
      expect(source).toContain('別の画面でイベントが更新されました。開き直してからもう一度保存してください。')
    }
    for (const hours of ['2', '24', '72']) expect(CREATE).toContain(`value: '${hours}'`)
    expect(CREATE).toContain('options={APPROVAL_OPTIONS}')
    expect(CREATE).toContain('continuingId')
    expect(CREATE).toContain('router.replace(`/events/edit?id=${encodeURIComponent(continuingId)}`)')
  })

  it('両画面が同じ既定値・上限・multi解決を参照する', () => {
    for (const source of [FORM, CREATE]) {
      expect(source).toContain('EVENT_DEFAULT_DRAFT')
      expect(source).toContain('EVENT_NAME_MAX_LENGTH')
      expect(source).toContain('EVENT_DESCRIPTION_MAX_LENGTH')
    }
    // 既定値の二重定義は無い。片方だけ変えられない形にする。
    expect(FORM).not.toMatch(/const DEFAULT_DRAFT: EventDetail = \{/)
    expect(CREATE).not.toMatch(/const DEFAULT_DRAFT: EventDetail = \{/)
    expect(FORM).toContain('const DEFAULT_DRAFT: EventDetail = EVENT_DEFAULT_DRAFT')
    expect(CREATE_DEFAULT_DRAFT).toBe(EVENT_DEFAULT_DRAFT)
    // 作成の送信物は解決器を通る（素の draft を送ると multi で 422 になる）。
    expect(CREATE).toContain('resolveEventMultiAccountIds(')
  })

  it('KPI の札は1部品に統合され、旧重複定義は残らない', () => {
    expect(LIST_PAGE).toContain(`from '@/components/shared/kpi-card'`)
    expect(BOOKINGS_PAGE).toContain(`from '@/components/shared/kpi-card'`)
    expect(LIST_PAGE).not.toMatch(/function Kpi\(/)
    expect(BOOKINGS_PAGE).not.toMatch(/function EventKpi\(/)
  })
})

/**
 * 追加47件イベント予約領域（EVENT-01〜06）の回帰。
 * 作成と編集でずれると事故になる表示契約だけを固定する。
 */
describe('イベント作成・編集の締切・取消・時刻表示(EVENT-01〜06)', () => {
  it('取消期限の意味は null=不可 / 0=直前まで / 正数=N時間前 で両画面共通(EVENT-03)', () => {
    expect(EVENT_CANCEL_DEADLINE_OPTIONS[0]).toMatchObject({ value: 'none' })
    expect(EVENT_CANCEL_DEADLINE_OPTIONS[0]!.label).toContain('不可')
    // 旧作成画面は null を「いつでもキャンセルできる」と表示し、
    // 編集画面の「不可」・API の 403 と逆の意味に見えていた。
    expect(EVENT_CANCEL_DEADLINE_OPTIONS.some((o) => o.value === '0')).toBe(true)
    for (const source of [FORM]) {
      expect(source).toContain('EVENT_CANCEL_DEADLINE_OPTIONS')
      expect(source).toContain('deadlineOptionsWithSaved(')
    }
    // 旧ラベルの残存は契約違反（null を許可と読ませる表示を残さない）。
    expect(CREATE).not.toContain('いつでもキャンセルできる')
    expect(CREATE_DEFAULT_DRAFT.cancel_deadline_hours_before).toBeNull()
    expect(EDIT_PAGE).not.toContain('承認するまで枠は確保されません')
  })

  it('締切の選択肢は両画面が同じ一覧を引き、保存値の見せ方も共通(EVENT-04)', () => {
    // 作成側だけが持っていた 2時間前 と、編集側だけが持っていた 1/3/168 を統合。
    for (const v of ['1', '2', '3', '24', '48', '168']) {
      expect(EVENT_ENTRY_CUTOFF_OPTIONS.some((o) => o.value === v)).toBe(true)
    }
    expect(FORM).toContain('EVENT_ENTRY_CUTOFF_OPTIONS')
    expect(ENTRY_CUTOFF_OPTIONS.map((option) => option.value)).toEqual(EVENT_ENTRY_CUTOFF_OPTIONS.map((option) => option.value))
  })

  it('選択肢に無い保存値は「保存済み」として出し、先頭項目に見せない(EVENT-04)', () => {
    const out = deadlineOptionsWithSaved(EVENT_ENTRY_CUTOFF_OPTIONS, 5)
    expect(out.some((o) => o.value === '5' && o.label === '保存済み：開始の5時間前まで')).toBe(true)
    // 数値昇順の位置に入る（2 と 24 の間）。
    expect(out.map((o) => o.value)).toEqual(
      expect.arrayContaining(['none', '1', '2', '3', '5', '24', '48', '168']),
    )
    expect(out.findIndex((o) => o.value === '5')).toBeGreaterThan(out.findIndex((o) => o.value === '3'))
    expect(out.findIndex((o) => o.value === '5')).toBeLessThan(out.findIndex((o) => o.value === '24'))
    // 一覧にある値・null では選択肢を増やさない。
    expect(deadlineOptionsWithSaved(EVENT_ENTRY_CUTOFF_OPTIONS, 2)).toHaveLength(
      EVENT_ENTRY_CUTOFF_OPTIONS.length,
    )
    expect(deadlineOptionsWithSaved(EVENT_ENTRY_CUTOFF_OPTIONS, null)).toHaveLength(
      EVENT_ENTRY_CUTOFF_OPTIONS.length,
    )
  })

  it('select 値の往復変換は保存値を変えない(EVENT-03/04)', () => {
    expect(deadlineSelectValue(null)).toBe('none')
    expect(deadlineSelectValue(undefined)).toBe('none')
    expect(deadlineSelectValue(0)).toBe('0')
    expect(deadlineSelectValue(2)).toBe('2')
    expect(parseDeadlineSelect('none')).toBeNull()
    expect(parseDeadlineSelect('0')).toBe(0)
    expect(parseDeadlineSelect('2')).toBe(2)
  })

  it('編集画面の日時表示は端末の時間帯に依存しない(EVENT-05)', () => {
    expect(formatJpDateTime('2026-10-16T16:30:00Z')).toMatch(/10月17日（土）01:30$/)
    // 一覧と編集の実際の表示結果を、日本時間の日またぎでそろえる。
    expect(LIST_PAGE).toContain("import { jstDay, jstTime } from './shared'")
    expect(jstDay('2026-10-16T16:30:00Z')).toBe('10/17（土）')
    expect(jstTime('2026-10-16T16:30:00Z')).toBe('01:30')
  })

  it('枠の更新は保存後に一覧を読み直す(EVENT-01)', () => {
    // PUT の戻り値は active_count を持たないため、一覧の再取得で残席を合わせる。
    expect(FORM).toMatch(/await updateSlotWithConflictRefresh\(editSlotTarget, next\)[\s\S]*?await refresh\(\)/)
    expect(FORM).toMatch(/async function refresh\([\s\S]*?listSlots\([\s\S]*?setSlots\(/)
  })

  it('公開OFFの保存はボタン名も公開と読ませない(EVENT-02)', () => {
    expect(CREATE).toContain('onClick={() => void save(false)}')
    expect(CREATE).toContain('if (validateInput()) setPublishOpen(true)')
    expect(CREATE).toContain('onConfirm={() => save(true)}')
    // 枠だけ失敗した公開済み本体の再試行では、公開状態を下書きへ戻さない。
    expect(CREATE).toContain('is_published: publish || saved?.is_published === 1 ? 1 : 0')
  })
})


it.each([
  ['2026-09-30T15:00:00Z', '00:00'],
  ['2026-09-30T23:59:59Z', '08:59'],
  ['2026-10-01T00:00:00Z', '09:00'],
])('一覧と編集の日本時間は同じ暦日と時刻になる: %s', (at, time) => {
  expect(jstDay(at)).toBe('10/1（木）')
  expect(jstTime(at)).toBe(time)
  expect(formatJpDateTime(at)).toMatch(new RegExp(`10月1日（木）${time}$`))
})
