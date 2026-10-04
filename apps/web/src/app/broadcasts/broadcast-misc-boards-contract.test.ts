import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')
const DETAIL = readFileSync(join(HERE, 'detail-v8.tsx'), 'utf8')
const RESERVED = readFileSync(join(HERE, 'reserved-v8.tsx'), 'utf8')
const QUICK = readFileSync(join(HERE, 'quick-send-dialog.tsx'), 'utf8')

/*
 * V8 一斉配信の細かい板（P6vbxn・NtCE3・BeNtj）。
 * かんたんに送るは小窓を作り、一覧の閲覧のみと予約の取り消しは
 * 同じ画面の状態として板IDを付ける。v7 は変えない。
 */
describe('一斉配信の細かい板', () => {
  it('かんたんに送るの小窓に板IDを付ける（P6vbxn）', () => {
    expect(QUICK).toContain('designNode="P6vbxn"')
    expect(QUICK).toContain('かんたんに送る')
  })

  it('一覧の閲覧のみに板IDを付ける（NtCE3）', () => {
    expect(LIST).toContain("data-design-node={canEdit ? 'EML2F bIdqV' : 'NtCE3'}")
  })

  it('予約の取り消しの確かめに板IDを付ける（BeNtj）', () => {
    expect(DETAIL).toContain('designNode="BeNtj"')
    expect(RESERVED).toContain('designNode="BeNtj"')
  })

  it('取り消しの確かめは残す方を主にする', () => {
    expect(DETAIL).toContain('cancelLabel="予約のまま残す"')
    expect(DETAIL).toContain('primaryAction="cancel"')
    expect(RESERVED).toContain('cancelLabel="予約のまま残す"')
  })
})
