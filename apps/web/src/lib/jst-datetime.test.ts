import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { jstDateOffset } from './jst-datetime'
import { describe, expect, test, vi, it } from 'vitest'
import { datetimeLocalJstToUtcIso, jstDate } from './jst-datetime'

describe('datetimeLocalJstToUtcIso（JST固定）', () => {
  test('datetime-localをJSTとしてUTCへ直す', () => {
    // 画面の「2026-09-10T10:00」はJSTの10時。UTCでは01:00。
    expect(datetimeLocalJstToUtcIso('2026-09-10T10:00')).toBe('2026-09-10T01:00:00.000Z')
  })

  test('秒付きもJSTとして扱う', () => {
    expect(datetimeLocalJstToUtcIso('2026-09-10T10:00:30')).toBe('2026-09-10T01:00:30.000Z')
  })

  test('タイムゾーン付きはそのままUTCへ直す', () => {
    expect(datetimeLocalJstToUtcIso('2026-09-10T10:00:00+09:00')).toBe('2026-09-10T01:00:00.000Z')
  })
})

// 決まり15：端末が日本時間以外でも、予約を日本時間として保存する。
test('統括の予約時刻を日本時間で保存し、存在しない日付を受け付けない', async () => {
  const { scheduledIso } = await import('@/v8/hq-broadcasts/model')
  expect(scheduledIso('2027-01-15', '11:00')).toBe('2027-01-15T02:00:00.000Z')
  expect(scheduledIso('2027-02-30', '11:00')).toBeNull()
})

test("今日の境目は日本の午前0時", () => {
  expect(jstDate(new Date("2026-10-09T14:59:59Z"))).toBe("2026-10-09")
  expect(jstDate(new Date("2026-10-09T15:00:00Z"))).toBe("2026-10-10")
})

 test('日本の月末の午前0時を基準に前後の日付を出す', () => {
  const now = new Date('2026-09-30T15:00:00Z')
  expect(jstDateOffset(0, now)).toBe('2026-10-01')
  expect(jstDateOffset(-1, now)).toBe('2026-09-30')
  expect(jstDateOffset(31, now)).toBe('2026-11-01')
 })

// 端末をUTC・ハワイに見立てる。JSTの00:09は同じ日本の当日。
test.each(['UTC', 'Pacific/Honolulu'])('端末が%sでも今日・月・時刻・検索範囲を日本時間で決める', async timezone => {
  const previous = process.env.TZ
  process.env.TZ = timezone
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T15:09:00Z'))
  try {
    const { jstMonthStart, jstDayStartIso, jstDateTimeLocal, jstTime } = await import('./jst-datetime')
    expect(jstDate()).toBe('2026-10-11')
    expect(jstMonthStart()).toBe('2026-10-01')
    expect(jstTime()).toBe('00:09')
    expect(jstDateTimeLocal()).toBe('2026-10-11T00:09')
    expect(jstDayStartIso()).toBe('2026-10-10T15:00:00.000Z')
    expect(jstDayStartIso(new Date(), 1)).toBe('2026-10-11T15:00:00.000Z')
    expect(jstDateOffset(-1)).toBe('2026-10-10')
    // 以前のUTC切り取りなら前日になる。境界を通る試験であることを確認。
    expect(new Date().toISOString().slice(0, 10)).not.toBe(jstDate())
  } finally {
    vi.useRealTimers()
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

/** 時刻の記録は許し、暦日を端末の地域で決める直書きだけを止める。 */
function rawCalendarCalls(source: string): number {
  const parsed=ts.createSourceFile('clock.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  let count=0
  const fresh=(node: ts.Node): boolean => ts.isNewExpression(node) && node.expression.getText(parsed)==='Date' && !node.arguments?.length
  const walk=(node: ts.Node) => {
    if(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const call=node.expression
      if(fresh(call.expression) && /^get(?:FullYear|Month|Date|Day|Hours|Minutes)$/.test(call.name.text)) count++
      if(call.name.text==='slice' && node.arguments[0]?.getText(parsed)==='0' && ['7','10'].includes(node.arguments[1]?.getText(parsed) ?? '') && ts.isCallExpression(call.expression) && ts.isPropertyAccessExpression(call.expression.expression) && call.expression.expression.name.text==='toISOString' && fresh(call.expression.expression.expression)) count++
    }
    ts.forEachChild(node,walk)
  }
  walk(parsed);return count
}
it('時計の直書きは故障注入で検出し、日本時間と記録のISOは通す', () => {
  expect(rawCalendarCalls('const today = new Date().toISOString().slice(0, 10); const month = new Date().getMonth()')).toBe(2)
  expect(rawCalendarCalls('const today = jstDate(); const hour = jstCalendar().getUTCHours(); const recordedAt = new Date().toISOString()')).toBe(0)
})
it('管理画面・LIFF・配備用Clientの全ソースで、端末の暦の直書きを増やさない', () => {
  const code=path.resolve(__dirname,'../../../..')
  const roots=['apps/web/src','apps/liff/src','apps/worker/src/client'].map(dir=>path.join(code,dir))
  const bad: string[]=[]
  const visit=(dir:string) => { for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name)
    if(entry.isDirectory()) visit(file)
    else if(/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) && rawCalendarCalls(fs.readFileSync(file,'utf8'))) bad.push(path.relative(code,file))
  } }
  for(const dir of roots) visit(dir)
  expect(bad).toEqual([])
})
