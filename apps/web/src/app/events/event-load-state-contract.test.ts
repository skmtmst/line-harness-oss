import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const EVENTS = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const BOOKINGS = readFileSync(join(HERE, 'bookings', 'page.tsx'), 'utf8')

describe('V6 イベント・申込者一覧の状態', () => {
  for (const [name, source] of [['イベント', EVENTS], ['申込者', BOOKINGS]] as const) {
    it(`${name}は読込・成功・失敗を別の状態として持つ`, () => {
      expect(source).toContain("type LoadStatus = 'loading' | 'ready' | 'error'")
      expect(source).toContain("setLoadStatus('ready')")
      expect(source).toContain("setLoadStatus('error')")
      expect(source).toContain("loadStatus === 'error'")
    })

    it(`${name}はアカウント切替前の遅い応答を採用しない`, () => {
      expect(source).toContain('const loadRequestRef = useRef(0)')
      expect(source).toContain('if (requestId !== loadRequestRef.current) return')
      expect(source).toContain('loadRequestRef.current += 1')
    })
  }

  it('イベント一覧は未取得のKPIを0件にしない', () => {
    expect(EVENTS).toContain("value={dataReady ? String(items.length) : '—'}")
    expect(EVENTS).toContain("value={dataReady ? String(kpi.applied) : '—'}")
    expect(EVENTS).toContain('登録したイベントは消えていません。')
  })

  it('申込者一覧は未取得のKPIを0件にせずCSVも止める', () => {
    expect(BOOKINGS).toContain("value={dataReady ? String(confirmed + pending) : '—'}")
    expect(BOOKINGS).toContain("value={dataReady ? String(waitlist.length) : '—'}")
    expect(BOOKINGS).toContain('disabled={!dataReady}')
    expect(BOOKINGS).toContain("const [capacityLoadStatus, setCapacityLoadStatus] = useState<LoadStatus>('loading')")
    expect(BOOKINGS).toContain("? '定員は取得できませんでした'")
  })

  it('申込者一覧はアカウント切替時に前のイベント名と定員を残さない', () => {
    expect(BOOKINGS).toContain('setEvent(null)')
    expect(BOOKINGS).toContain('setTotalCapacity(null)')
    expect(BOOKINGS).toContain('eventsApi.getEvent(selectedAccountId, eventId)')
    expect(BOOKINGS).not.toContain('Promise.resolve(event)')
  })

  it('操作失敗は内部エラーでなく、一覧を残したまま日本語で案内する', () => {
    expect(BOOKINGS).not.toContain("setError(e instanceof Error ? e.message : String(e))")
    expect(BOOKINGS).toContain('const [actionError, setActionError]')
    expect(BOOKINGS).toContain('予約を確定・拒否できませんでした。')
    expect(BOOKINGS).toContain('{actionError}')
  })
})
