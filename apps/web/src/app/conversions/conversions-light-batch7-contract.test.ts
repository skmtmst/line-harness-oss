import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const NEW_PAGE = readFileSync(join(import.meta.dirname, 'new', 'page.tsx'), 'utf8')

describe('点検・軽 第7便コンバージョン(#585)', () => {
  it('飾りの表示件数切り替えを置かない(#513 L1)', () => {
    expect(PAGE).toContain('setPageSize(Number(value))')
    expect(PAGE).toContain('page * pageSize')
    expect(PAGE).not.toContain('onChange={() => undefined}')
  })

  it('CSV保存は1つの送り出しに寄せる(#513 L2)', () => {
    expect(PAGE).toContain('function downloadCsvBlob(blob: Blob, filename: string): void')
    expect(PAGE).toContain('downloadCsvBlob(blob, `conversion-definitions-')
    // 送り出し本体の1か所だけに残る。二重の直書きに戻っていない。
    expect(PAGE.split('URL.createObjectURL(blob)').length - 1).toBe(1)
  })

  it('作成前の検証は保存側と同じ条件を先に言う(#513 L3)', () => {
    expect(NEW_PAGE).toContain('固定で付ける金額は0以上の数値で入力してください')
    expect(NEW_PAGE).toContain('成果を紐づける日数は1〜365日で入力してください')
  })

  it('同名警告は同じ集計対象の中だけで出す(#513 L4)', () => {
    expect(NEW_PAGE).toContain('point.lineAccountId == null || point.lineAccountId === lineAccountId')
  })




  it('空状態の案内は作成ボタンの名前と一致する(#513 L8)', () => {
    expect(PAGE).toContain('「成果地点を作る」から登録すると、ここに出ます。')
    expect(PAGE).not.toContain('右上の「成果地点を追加」')
    expect(PAGE).not.toContain('右上の「成果地点をつくる」')
  })

  it('読まれない深掘り受け渡しを付けない(#513 L9)', () => {
    expect(PAGE).not.toContain('tab=points&point=')
  })
})
