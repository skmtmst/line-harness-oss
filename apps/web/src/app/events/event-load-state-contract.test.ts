/*
 * イベントと申込者の一覧で、**読めなかったのか 0件なのか**を分ける。
 *
 * 0 は「無い」という事実の表示。取れなかったところに 0 を書くと、
 * **承認待ちの人を見落とし、締め切りの判断を誤る。**
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const EVENTS = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const BOOKINGS = readFileSync(join(HERE, 'bookings', 'page.tsx'), 'utf8')
const EDIT = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')

/** 説明の文だけで通ってしまわないよう、判定の前にコメントを落とす。 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('V6 イベント・申込者一覧の状態', () => {
  for (const [name, source] of [['イベント', EVENTS], ['申込者', BOOKINGS]] as const) {
    const body = code(source)

    it(`${name}は読込・成功・失敗を別の状態として持つ`, () => {
      expect(body).toContain("setLoadStatus('ready')")
      expect(body).toContain("setLoadStatus('error')")
      expect(body).toContain("loadStatus === 'error'")
    })

    it(`${name}は切替前の遅い応答を採用しない`, () => {
      // 前のアカウント・前の絞り込みの応答が、次の一覧に混ざらないこと。
      expect(body).toContain('loadRequestRef')
      expect(body).toContain('if (requestId !== loadRequestRef.current) return')
    })

    it(`${name}は失敗したときに一覧を0件と同じ文で出さない`, () => {
      expect(body).toContain('ListState')
      expect(body).toContain('消えていません')
    })
  }

  it('イベント一覧は未取得の帯を0件にしない', () => {
    const body = code(EVENTS)
    // 帯は「数」ではなく「次にすること」を出す（`event-attention.ts`）。
    expect(body).toContain("value={dataReady ? String(attention.upcoming.length) : '—'}")
    expect(body).toContain("value={dataReady ? String(attention.applied) : '—'}")
    expect(body).toContain('登録したイベントは消えていません。')
  })

  it('申込者一覧は未取得の帯を0件にしない', () => {
    const body = code(BOOKINGS)
    expect(body).toContain("value={dataReady ? String(applied) : '—'}")
    expect(body).toContain("value={dataReady ? String(pending) : '—'}")
    expect(body).toContain("value={dataReady ? String(cancelled) : '—'}")
    expect(body).toContain('受け付けた予約は消えていません。')
  })

  it('申込者一覧は「定員なし」と「定員を取れなかった」を分ける', () => {
    const body = code(BOOKINGS)
    // 上限が無いのか読めなかったのかで、締め切りの判断が変わる。
    expect(body).toContain('capacityStatus')
    expect(body).toContain("'定員は取得できませんでした'")
    // 「定員なし」の言い分けは `event-attention.ts` の
    // `describeBookingCapacity` に寄せた（帯と窓で同じ言い方にするため）。
    expect(body).toContain('describeBookingCapacity(applied, capacity)')
  })

  it('申込者一覧は切替後に前のイベント名と定員を残さない', () => {
    const body = code(BOOKINGS)
    expect(body).toContain('setEvent(null)')
    expect(body).toContain('setTotalCapacity(null)')
    // 控えがあれば取りに行かない、をやめる（前のイベント名が残る）。
    expect(body).not.toContain('Promise.resolve(event)')
  })

  it('編集画面から申込者一覧へのリンクは申込者画面の読む引数名と揃える', () => {
    // 申込者画面は `id` だけを読む。一覧と作成フォームは `?id=` で正しい。
    expect(code(BOOKINGS)).toContain("params.get('id')")
    expect(code(EDIT)).toContain('/events/bookings?id=${eventId}')
    expect(code(EDIT)).toContain('/events/bookings?id=${id}')
    // `?eventId=` では「イベントを選び直してください」になり、承認待ちへ行けない。
    expect(code(EDIT)).not.toContain('bookings?eventId=')
  })

  it('定員は枠の一覧から数え、200件超えは注意を出す(点検#520の中8)', () => {
    const body = code(BOOKINGS)
    // 申込者画面はイベント一覧の全件取得をやめ、枠の一覧から数える。
    expect(body).toContain('.listSlots(selectedAccountId, eventId)')
    expect(body).not.toContain('eventsApi.listEvents(')
    expect(body).toContain('slots.some((slot) => slot.capacity == null)')
    expect(body).toContain('setBookingsTotal')
    expect(BOOKINGS).toContain('200件まで表示しています。状態の絞り込みを変えて探してください。')
    const list = code(EVENTS)
    expect(list).toContain('setListTotal')
    expect(EVENTS).toContain('200件まで表示しています')
  })

  it('編集画面は取得失敗を黙って0件にせず帯と読み直しを出す(点検#520の中10)', () => {
    const body = code(EDIT)
    expect(body).toContain('setLoadError')
    expect(body).toContain('setReloadSeq')
    expect(EDIT).toContain('一部を取得できませんでした。数は実際より少なく見えます。')
    expect(EDIT).toContain('読み直す')
  })

  it('操作の失敗を内部の文字で出さず、一覧は残す', () => {
    const body = code(BOOKINGS)
    expect(body).not.toContain('setError(e instanceof Error ? e.message : String(e))')
    expect(body).toContain('const [actionError, setActionError]')
    // 確定と拒否は出す場所が違う（拒否は窓の中）ので、文も分けた。
    expect(body).toContain('予約を確定できませんでした。')
    expect(body).toContain('予約を拒否できませんでした。')
    expect(body).toContain('{actionError}')
  })
})
