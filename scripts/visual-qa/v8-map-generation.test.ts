import { describe, expect, it } from 'vitest'
// @ts-expect-error JS tool
import { buildRows } from './build-v8-board-to-code.mjs'
const map = { boards: { home: { url: '/?tab=activity' }, fields: { url: '/tags?tab=fields' } } }

describe('ROOT-19 二つの対応表を同じURLから作る', () => {
  it('古い文書のURLではなく撮影の対応表の実URLを使う', () => {
    const rows = buildRows(map, [['V8', 'home', 'ホーム', '/notifications'], ['V8', 'fields', '情報欄', '/tags']])
    expect(rows.map((r: { url: string }) => r.url)).toEqual(['/?tab=activity', '/tags?tab=fields'])
  })
  it('場所が決まっていない板を古い文書のURLで撮れるようにしない', () => {
    const rows = buildRows({ boards: { unknown: { name: '不明', route: null, url: null } } }, [['V8', 'unknown', '不明', '/notifications']])
    expect(rows[0].url).toBeNull()
  })
})
