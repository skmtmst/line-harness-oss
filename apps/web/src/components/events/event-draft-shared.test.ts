import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EVENT_DEFAULT_DRAFT,
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_NAME_MAX_LENGTH,
  resolveEventMultiAccountIds,
} from './event-draft-shared'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')
const FORM = read('event-form.tsx')
const WIZARD = read('event-wizard.tsx')
const LIST_PAGE = readFileSync(join(HERE, '..', '..', 'app', 'events', 'page.tsx'), 'utf8')
const BOOKINGS_PAGE = readFileSync(join(HERE, '..', '..', 'app', 'events', 'bookings', 'page.tsx'), 'utf8')

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
    for (const source of [FORM, WIZARD]) {
      expect(source).toContain('approval_deadline_hours')
      expect(source).toContain("{ value: '2', label: '申込から2時間' }")
      expect(source).toContain("{ value: '24', label: '申込から24時間' }")
      expect(source).toContain("{ value: '72', label: '申込から72時間' }")
      expect(source).toContain('options={APPROVAL_DEADLINE_OPTIONS}')
      expect(source).toMatch(/eventsApi\.updateEvent\([\s\S]*?draft\.version \?\? 1/)
      expect(source).toContain("e.status === 409 && e.code === 'version_conflict'")
      expect(source).toContain('別の画面でイベントが更新されました。開き直してからもう一度保存してください。')
    }
  })

  it('両画面が同じ既定値・上限・multi解決を参照する', () => {
    for (const source of [FORM, WIZARD]) {
      expect(source).toContain('EVENT_DEFAULT_DRAFT')
      expect(source).toContain('EVENT_NAME_MAX_LENGTH')
      expect(source).toContain('EVENT_DESCRIPTION_MAX_LENGTH')
    }
    // 既定値の二重定義は無い。片方だけ変えられない形にする。
    expect(FORM).not.toMatch(/const DEFAULT_DRAFT: EventDetail = \{/)
    expect(WIZARD).not.toMatch(/const DEFAULT_DRAFT: EventDetail = \{/)
    expect(FORM).toContain('const DEFAULT_DRAFT: EventDetail = EVENT_DEFAULT_DRAFT')
    expect(WIZARD).toContain('const DEFAULT_DRAFT: EventDetail = EVENT_DEFAULT_DRAFT')
    // 作成の送信物は解決器を通る（素の draft を送ると multi で 422 になる）。
    expect(WIZARD).toContain('resolveEventMultiAccountIds(')
  })

  it('KPI の札は1部品に統合され、旧重複定義は残らない', () => {
    expect(LIST_PAGE).toContain(`from '@/components/events/event-kpi'`)
    expect(BOOKINGS_PAGE).toContain(`from '@/components/events/event-kpi'`)
    expect(LIST_PAGE).not.toMatch(/function Kpi\(/)
    expect(BOOKINGS_PAGE).not.toMatch(/function EventKpi\(/)
  })
})
