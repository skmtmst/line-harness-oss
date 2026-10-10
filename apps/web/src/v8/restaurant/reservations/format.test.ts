import {describe,it,expect} from 'vitest'
import {hm,minutesOf,dayRange} from './format'
describe('予約盤と詳細・印刷の時刻',()=>{
 it('同じ瞬間をUTCまたは日本時間で受け取っても19時としてそろえる',()=>{
  for(const instant of ['2026-10-02T19:00:00+09:00','2026-10-02T10:00:00Z']){expect(hm(instant)).toBe('19:00');expect(minutesOf(instant)).toBe(19*60)}
 })
 it('選んだ日の印刷は、日本時間の0時から翌0時までを取り直す',()=>{
  expect(dayRange(new Date(2026,9,2,12))).toEqual({from:'2026-10-01T15:00:00.000Z',to:'2026-10-02T15:00:00.000Z'})
 })
})
