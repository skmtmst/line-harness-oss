import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestD1 } from './d1-sqlite.js'

const fixtures: ReturnType<typeof createTestD1>[] = []
afterEach(() => {
  fixtures.splice(0).forEach(f => f.raw.close())
  vi.useRealTimers()
})

const boundaries = [
  '2026-10-11T15:09:00Z', '2026-10-11T23:59:00Z',
  '2026-10-12T00:00:00Z', '2026-10-12T14:59:00Z',
]

describe('SQLiteとJavaScriptの試験時計', () => {
  it.each(boundaries)('DEFAULT・trigger・nowは固定時計を読み、時刻を進めると追従する（%s）', instant => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(instant))
    const fixture = createTestD1({ now: () => new Date() })
    fixtures.push(fixture)
    const { raw } = fixture
    raw.exec(`CREATE TABLE clock_probe(id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE clock_events(at TEXT);
      CREATE TRIGGER clock_insert AFTER INSERT ON clock_probe BEGIN
        INSERT INTO clock_events VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
      INSERT INTO clock_probe DEFAULT VALUES;`)
    expect(raw.prepare('SELECT at FROM clock_probe').get()).toEqual({ at: instant.replace('T', ' ').slice(0, 19) })
    expect(raw.prepare('SELECT at FROM clock_events').get()).toEqual({ at: new Date().toISOString() })
    expect(raw.prepare("SELECT julianday('now')=julianday(?) AS same, datetime('now','+1 day')=datetime(?,'+1 day') AS tomorrow").get(instant, instant))
      .toEqual({ same: 1, tomorrow: 1 })
    expect(raw.prepare('SELECT date()=CURRENT_DATE AS day, time()=CURRENT_TIME AS time, unixepoch()=unixepoch(?) AS epoch').get(instant))
      .toEqual({ day: 1, time: 1, epoch: 1 })
    vi.setSystemTime(new Date(Date.now() + 60_000))
    raw.exec('INSERT INTO clock_probe DEFAULT VALUES')
    expect(raw.prepare('SELECT at FROM clock_events ORDER BY rowid DESC LIMIT 1').get()).toEqual({ at: new Date().toISOString() })
  })

  it('過去の明示日時・UTC修飾子・不正な日時のSQLiteによる判定を保つ', () => {
    const fixture = createTestD1({ now: () => new Date('2026-10-11T15:09:00Z') })
    fixtures.push(fixture)
    expect(fixture.raw.prepare("SELECT datetime('2020-01-01 00:00:00','+9 hours') AS legacy, strftime('%Y-%m-%d','now','+9 hours') AS today, datetime('invalid') AS invalid").get())
      .toEqual({ legacy: '2020-01-01 09:00:00', today: '2026-10-12', invalid: null })
  })
})
