import { describe, expect, it } from 'vitest'
import { broadcastCsvFilename } from './broadcast-csv-filename'

describe('一斉配信のCSVファイル名', () => {
  it('斜線・制御文字・OS予約記号を無害な文字へ置き換える', () => {
    expect(broadcastCsvFilename('9/8\u0000 特売:*?', 'b-1')).toBe('9-8- 特売----配信結果.csv')
  })

  it('名前が空になった場合は配信IDへ戻す', () => {
    expect(broadcastCsvFilename('///', 'b-1')).toBe('----配信結果.csv')
    expect(broadcastCsvFilename('   ', 'b-1')).toBe('broadcast-b-1-配信結果.csv')
  })
})
