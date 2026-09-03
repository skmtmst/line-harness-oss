import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const LIST = fs.readFileSync(path.join(__dirname, 'field-list.tsx'), 'utf8')

/** 注釈を落とす。「なぜ直したか」を書いた文が、直したはずの字面に当たるのを避ける。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CODE = code(LIST)

/** 帯を組み立てているところだけを切り出す。表の桁の同じ字面に当たらないようにする。 */
function cardsBlock(): string {
  const at = CODE.indexOf('const cards = [')
  if (at < 0) return ''
  return CODE.slice(at, CODE.indexOf(']', CODE.indexOf("今月の更新", at)))
}

/**
 * 設計の決めごとは「数字を空欄にしない。`—` を出し、すぐ横に理由を置く」。
 *
 * 以前は `summary` が無いと1枚目の補足が**空文字**になり、
 * 残る3枚は「1項目以上を登録」「追加・編集」という**数え方の説明のまま**だった。
 * 読込中も取得失敗も同じ見た目になり、待てば出るのか壊れているのかが分からない。
 */
describe('友だち情報欄の帯は、数が出せない理由を添える', () => {
  it('言葉は共通部品から取る（画面ごとに作らない）', () => {
    expect(CODE).toContain("from '@/components/shared/not-connected'")
    expect(CODE).toContain('STATE_TEXT.loading')
    expect(CODE).toContain('STATE_TEXT.error')
  })

  it('読込中・取得失敗・権限不足を言い分ける', () => {
    expect(CODE).toContain("status === 'loading' ? STATE_TEXT.loading")
    expect(CODE).toContain("status === 'error' ? STATE_TEXT.error")
  })

  /*
    403 は `setStatus('forbidden')` へ行く。`status === 'error'` の中で
    `error === ''` を権限不足のしるしにしていたときは、その枝に**一度も
    入らず**、帯は数え方の説明のままだった。`status` で直に見る。
  */
  it('権限不足は status で見る（error の空文字で当てない）', () => {
    expect(CODE).toContain("status === 'forbidden' ? STATE_TEXT.forbiddenView")
    expect(CODE, '403 は status が forbidden になるので、この当て方では入らない')
      .not.toContain("error === '' ? STATE_TEXT.forbiddenView")
  })

  /*
    **中の言い回しまで固定しない。** 見たいのは「4枚とも状態の理由に
    差し替わるか」で、数え方の説明の書き方ではない。字面ごと固定すると、
    別の直し（`inUse` が入っていないときに `undefined件` と出さない、など）を
    入れたときに、直したのに落ちる嘘の失敗になる。
    `friend-attributes-v4-contract.test.ts` が同じ理由で緩めてある。
  */
  it('4枚とも理由に差し替わる', () => {
    const block = cardsBlock()
    expect(block, '帯の組み立てが見つからない').not.toBe('')
    const titles = ['項目数', '登録済み友だち', '今月の更新']
    for (const title of titles) {
      const at = block.indexOf(title)
      expect(at, `帯「${title}」が見つからない`).toBeGreaterThan(-1)
      const card = block.slice(at, block.indexOf('title:', at + 1) === -1 ? block.length : block.indexOf('title:', at + 1))
      expect(card, `帯「${title}」が状態の理由へ差し替わっていない`).toContain('detailOf(')
    }
    // フォーム連携だけは「口が無い」を別の言葉にするので `kpiReason` を直に読む。
    expect(block).toContain('kpiReason ??')
  })

  it('口が無いときは、読込・失敗とは別の言葉にする', () => {
    expect(CODE).toContain("notConnectedText('回答フォームの登録先')")
    expect(CODE, '「未取得」の一語だけで済ませている').not.toContain("? '未取得' :")
  })
})
