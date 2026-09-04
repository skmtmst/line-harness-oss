import { describe, expect, it } from 'vitest'
import { EXPORT_HEADER, exportFileName, toCsv, type ExportRow } from './inflow-export'

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  name: '夏のInstagram投稿',
  ref: 'summer-ig',
  clicks: 1240,
  friendAdds: 86,
  lastAddedAt: '2026/08/25 09:12',
  ...over,
})

describe('流入経路の書き出し', () => {
  it('見出しは画面の列と同じ言葉', () => {
    expect(EXPORT_HEADER).toEqual(['流入元名', 'REF', 'クリック', '友だち追加', '最新の追加'])
  })

  it('取れていない値を0にしない', () => {
    /*
      0回と「まだ数えていない」は別のこと。書き出したあとは画面の断り書きが
      付いてこないので、ここで取り違えると手元のファイルだけが残る。
    */
    const csv = toCsv([row({ lastAddedAt: null })])
    expect(csv.split('\n')[1].endsWith(',—')).toBe(true)
    expect(csv).not.toContain(',0\n')
  })

  it('実値0はそのまま0', () => {
    expect(toCsv([row({ clicks: 0, friendAdds: 0 })]).split('\n')[1]).toContain(',0,0,')
  })

  it('区切りや引用符を含む名前を壊さない', () => {
    const csv = toCsv([row({ name: '春,夏"秋"' })])
    expect(csv.split('\n')[1].startsWith('"春,夏""秋""",')).toBe(true)
  })

  it('改行を含む名前は引用符で囲む', () => {
    // 囲まないと、1件が2件に化けて読まれる。
    const csv = toCsv([row({ name: '上\n下' })])
    expect(csv).toContain('"上\n下"')
  })

  it('何本をいつ書き出したかが名前で分かる', () => {
    expect(exportFileName(24, '2026-08-31')).toBe('流入経路_24本_2026-08-31.csv')
  })
})

describe('取れていない数', () => {
  it('クリックと友だち追加の未取得を0にしない', () => {
    // 書き出したファイルには画面の断り書きが付いてこない。
    // ここで 0 と書くと、あとから「1回も無かった」と読まれる。
    const csv = toCsv([
      { name: '夏のInstagram投稿', ref: 'summer-ig', clicks: null, friendAdds: null, lastAddedAt: null },
    ])
    expect(csv.split('\n')[1]).toBe('夏のInstagram投稿,summer-ig,—,—,—')
  })

  it('本当の0はそのまま0と書く', () => {
    const csv = toCsv([
      { name: '紙のちらし', ref: 'flyer', clicks: 0, friendAdds: 0, lastAddedAt: null },
    ])
    expect(csv.split('\n')[1]).toBe('紙のちらし,flyer,0,0,—')
  })
})
