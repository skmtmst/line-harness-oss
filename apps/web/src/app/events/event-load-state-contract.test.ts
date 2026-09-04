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
    expect(body).toContain("value={dataReady ? String(confirmed + pending) : '—'}")
    expect(body).toContain("value={dataReady ? String(pending) : '—'}")
    expect(body).toContain("value={dataReady ? String(cancelled) : '—'}")
    expect(body).toContain('受け付けた予約は消えていません。')
  })

  it('申込者一覧は「定員なし」と「定員を取れなかった」を分ける', () => {
    const body = code(BOOKINGS)
    // 上限が無いのか読めなかったのかで、締め切りの判断が変わる。
    expect(body).toContain('capacityStatus')
    expect(body).toContain("'定員は取得できませんでした'")
    expect(body).toContain("'定員なし'")
  })

  it('申込者一覧は切替後に前のイベント名と定員を残さない', () => {
    const body = code(BOOKINGS)
    expect(body).toContain('setEvent(null)')
    expect(body).toContain('setTotalCapacity(null)')
    // 控えがあれば取りに行かない、をやめる（前のイベント名が残る）。
    expect(body).not.toContain('Promise.resolve(event)')
  })

  it('操作の失敗を内部の文字で出さず、一覧は残す', () => {
    const body = code(BOOKINGS)
    expect(body).not.toContain('setError(e instanceof Error ? e.message : String(e))')
    expect(body).toContain('const [actionError, setActionError]')
    expect(body).toContain('予約を確定・拒否できませんでした。')
    expect(body).toContain('{actionError}')
  })
})
