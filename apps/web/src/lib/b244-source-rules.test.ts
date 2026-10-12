import { describe, expect, it } from 'vitest'
// @ts-expect-error Node のソース検査を同じ故障注入で確認する。
import { inspectB244Source, inspectB244Tree } from '../../scripts/verify-b244.mjs'

describe('B-244/245 ソースの見張り', () => {
  it('必須・任意の矛盾と保存検査の定義抜けを止める', () => {
    expect(inspectB244Source('<Field required optional />').map((r: {kind:string}) => r.kind)).toEqual(['requirement-conflict'])
    expect(inspectB244Source("fields.define('name','名前',check); <Field requirement={fields.requirement('name')} />").map((r: {kind:string}) => r.kind)).toEqual(['requirement-without-definition'])
    expect(inspectB244Source("fields.define('name','名前',check,{required:true}); <Field requirement={fields.requirement('name')} />")).toEqual([])
  })
  it('一覧の常設の案内だけを止め、状態の知らせと確認の窓は残す', () => {
    expect(inspectB244Source('<ListPage><Notice tone="info">毎回出る説明</Notice></ListPage>').map((r: {kind:string}) => r.kind)).toEqual(['permanent-list-notice'])
    expect(inspectB244Source('<ListPage>{unset && <Notice tone="info">未設定</Notice>}<Dialog><Notice tone="info">確認</Notice></Dialog></ListPage>')).toEqual([])
  })
  it('対象の全V8ファイルに違反がない', () => {
    expect(inspectB244Tree(new URL('../..', import.meta.url).pathname).errors).toEqual([])
  })
})
