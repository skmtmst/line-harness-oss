import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const VERSIONS = readFileSync(join(HERE, 'versions', 'page.tsx'), 'utf8')

/*
 * 監査 R465: アカウントや検索条件を変えても、遅れて届いた古い応答が
 * 現在の一覧・詳細を上書きしない。取得キー（世代）を持ち、古い応答を捨てる。
 * 対象が変わったら旧詳細と操作（編集・公開ボタン）をクリアする。
 */
describe('古い応答の破棄（監査 R465）', () => {
  it('一覧は取得の世代を持ち、古い応答を捨てる', () => {
    expect(LIST).toContain('requestSeq')
    expect(LIST).toContain('requestSeq.current !== my')
  })

  it('版の画面は取得の世代を持ち、対象変更で旧詳細と操作をクリアする', () => {
    expect(VERSIONS).toContain('requestSeq')
    expect(VERSIONS).toContain('requestSeq.current !== my')
    // 対象（アカウント/ID）が変わったら、前の一覧・詳細を残さない。
    expect(VERSIONS).toContain('setDetail(null)')
    expect(VERSIONS).toContain('setPendingBindingId(null)')
  })
})
