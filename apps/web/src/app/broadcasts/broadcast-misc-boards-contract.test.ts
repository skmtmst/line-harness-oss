import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
// 一覧の入口は src/v8/broadcasts/list.tsx（古い list-v8.tsx はもう描かれない）。
const LIST = readFileSync(join(HERE, '../../v8/broadcasts/list.tsx'), 'utf8')
const DETAIL = readFileSync(join(HERE, 'detail-v8.tsx'), 'utf8')
const RESERVED = readFileSync(join(HERE, 'reserved-v8.tsx'), 'utf8')

/*
 * V8 一斉配信の細かい板（P6vbxn・NtCE3・BeNtj）。
 * 一覧の閲覧のみと予約の取り消しは同じ画面の状態として板IDを付ける。v7 は変えない。
 * かんたんに送る（P6vbxn）の小窓は今の V8 一覧に無い（古い list-v8.tsx だけが出していた）ので見張りを外した。
 */
describe('一斉配信の細かい板', () => {
  it('一覧の閲覧のみに板IDを付ける（NtCE3）', () => {
    expect(LIST).toContain("const boardId = narrow ? 'jjFNi' : canEdit ? 'l5V9a' : 'NtCE3'")
    expect(LIST).toContain('boardId={boardId}')
  })

  it('予約の取り消しの確かめに板IDを付ける（BeNtj）', () => {
    expect(DETAIL).toContain('designNode="BeNtj"')
    expect(RESERVED).toContain('designNode="BeNtj"')
  })

  it('取り消しの確かめは残す方を主にする', () => {
    expect(DETAIL).toContain('cancelLabel="予約のまま残す"')
    expect(DETAIL).toContain('primaryAction="cancel"')
    // 予約後の窓は3操作を独自footerへ移した。残す操作を主ボタンにする。
    expect(RESERVED).toMatch(/<Button[^>]*variant="primary"[^>]*onClick=\{closeCancel\}[^>]*>[\s\S]*?予約のまま残す/)
    expect(RESERVED).toMatch(/variant="danger" onClick=\{confirmCancel\}/)
  })
})
