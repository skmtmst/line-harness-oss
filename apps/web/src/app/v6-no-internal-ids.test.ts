import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 運用者の画面に、内部IDとデータベースの語を出さない（V6の5画面）。
 *
 * 実装画像を1枚ずつ見て見つかったもの:
 *
 *   `n5VVTb` 成果承認    友だち列の全行に `friend-1…`〜`friend-7…`
 *   `jwrbf`  紹介者      `クリック (ref_tracking)` / `IDENTITY_KEY` /
 *                        札 `friend-4…` / 列見出し `ref_code`
 *   `voJtX`  登録メディア 使い先の並びに `card_message`
 *   `MvZm5`  マイル履歴   `調整元ID: INQ-20260823-018`
 *   `HIU5O`  マイル明細   `調整元ID: ORD-20260822-0…`
 *
 * **1つずつ直しても戻る。** `クリック (ref_tracking)` は 2026-08-29 に直して
 * いる（PR #563）が、そのPRが取り込まれないまま `codex/development` が先へ
 * 進んだので、画面には出たままだった。**JSXへ直に書いた文字列は、誰も見張って
 * いない。** ここで走査して、戻ったら落ちるようにする。
 *
 * **ファイル全体を `toContain` で見ない。** それだと「どこかに在る」しか
 * 分からず、消したはずの行が別の場所に戻っても気づけない。表示に当たる部分
 * （タグの間の文字・目に見える属性・テンプレート文字列）だけを取り出して見る。
 */

const SCREENS = [
  { node: 'n5VVTb / jwrbf', path: 'affiliates/tabs.tsx' },
  { node: 'n5VVTb / jwrbf', path: 'conversions/page.tsx' },
  { node: 'voJtX', path: 'contents/page.tsx' },
  { node: 'MvZm5', path: 'mileage/mileage-history-tab.tsx' },
  { node: 'HIU5O', path: 'mileage/friends/detail/page.tsx' },
] as const

function read(path: string): string {
  return readFileSync(new URL(`./${path}`, import.meta.url), 'utf8')
}

/** コメントを外す。`{/* … *\/}` の中の説明文まで走査すると意味が無い。 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * 表示に当たる部分だけを取り出す。
 *
 *   1. タグとタグの間の文字（`{}` を含む式は中身が変数なので外す）
 *   2. 目に見える属性（`title` `aria-label` など）の文字列
 *   3. テンプレート文字列の地の文（`調整元ID: ${…}` のような組み立て）
 *
 * 受け口の項目名（`link.ref_code` `item.friendId`）は式なので入らない。
 * **項目名まで禁じると、受け口を読むことすらできなくなる。**
 */
function displayText(source: string): string {
  const stripped = withoutComments(source)
  const parts: string[] = []
  for (const match of stripped.matchAll(/>([^<>{}]+)</g)) parts.push(match[1])
  for (const match of stripped.matchAll(
    /\b(?:title|aria-label|placeholder|label|description|note|sub|alt)\s*=\s*"([^"]*)"/g,
  )) parts.push(match[1])
  for (const match of stripped.matchAll(
    /\b(?:title|aria-label|placeholder|label|description|note|sub|alt)\s*=\s*'([^']*)'/g,
  )) parts.push(match[1])
  for (const match of stripped.matchAll(/`([^`]*)`/g)) parts.push(match[1])
  return parts.join('\n')
}

/** 画面に出てはいけない語。 */
const BANNED = [
  { pattern: /friend-\d/, why: '友だちの内部ID' },
  { pattern: /\bINQ-/, why: '問い合わせ番号' },
  { pattern: /\bORD-/, why: '注文番号' },
  { pattern: /ref_code/i, why: 'リンク表の列名' },
  { pattern: /ref_tracking/i, why: '流入計測の表名' },
  { pattern: /identity_key/i, why: '突き合わせ用の列名' },
  { pattern: /card_message/i, why: '一斉配信素材の内部名' },
]

/** 目印から目印までを切り出す。**全文を渡さないための道具。** */
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`開始の目印が見つからない: ${start}`)
  if (source.indexOf(start, from + start.length) >= 0) {
    throw new Error(`開始の目印が2か所以上ある: ${start}`)
  }
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`終了の目印が見つからない: ${end}`)
  return source.slice(from, to)
}

describe('V6の画面に内部IDとDBの語を出さない', () => {
  for (const screen of SCREENS) {
    it(`${screen.path}（${screen.node}）の表示部分に内部の語が無い`, () => {
      const text = displayText(read(screen.path))
      for (const { pattern, why } of BANNED) {
        expect(text, `${screen.path} の表示に ${why} が出ている`).not.toMatch(pattern)
      }
    })
  }

  it('IDを途中で切って出す書き方を残さない', () => {
    // `friend-4…` は名前でも識別子でもない。断片はIDより読めない。
    for (const screen of SCREENS) {
      const source = withoutComments(read(screen.path))
      expect(source, screen.path).not.toMatch(/friendId\s*\.\s*slice\s*\(/)
    }
  })

  it('マイルの2画面が調整元IDを組み立てない', () => {
    for (const path of ['mileage/mileage-history-tab.tsx', 'mileage/friends/detail/page.tsx']) {
      const source = withoutComments(read(path))
      expect(source, path).not.toContain('調整元ID')
      expect(source, path).toContain('mileageSourceNoteText(')
    }
  })
})

describe('成果承認 n5VVTb の友だち列', () => {
  const CELL = between(
    read('affiliates/tabs.tsx'),
    '{items.map((item) => (',
    '{item.affiliateName',
  )

  it('名前だけを出し、内部IDを添えない', () => {
    expect(CELL).toContain('{personNameText(item.friendName)}')
    expect(CELL).not.toContain('item.friendId')
    expect(CELL).not.toContain('不明')
  })
})

describe('紹介者 jwrbf の内訳', () => {
  const TABS = read('affiliates/tabs.tsx')

  it('集計カードの見出しに表名を出さない', () => {
    const CARDS = between(TABS, '{/* v2 summary cards */}', '{/* Per-offer breakdown */}')
    expect(CARDS).toContain('{CLICK_SUMMARY_LABEL}')
    expect(CARDS).not.toContain('ref_tracking')
  })

  it('重複の見出しと札に列名もIDも出さない', () => {
    const DUP = between(TABS, '{/* Duplicate flags */}', '{/* CV by point */}')
    expect(DUP).toContain('{duplicateFlagHeading(report.duplicateFlags.length)}')
    expect(DUP).toContain('{duplicateFriendNameText(f.friendId, journeys)}')
    expect(DUP).not.toMatch(/identity_key/i)
    expect(DUP).not.toContain('f.friendId.slice')
  })

  it('リンク別クリックの列見出しを運用者の言葉にする', () => {
    const HEAD = between(TABS, '{/* Links table */}', '</thead>')
    expect(HEAD).toContain('<th className="pb-1 pr-4">{LINK_CODE_HEADING}</th>')
    expect(HEAD).not.toContain('>ref_code<')
  })

  it('帰属ジャーニーの列見出しと友だち名を運用者の言葉にする', () => {
    const HEAD = between(TABS, '<th className="pb-1 pr-4">友だち</th>', '</thead>')
    expect(HEAD).toContain('<th className="pb-1 pr-4">{LINK_CODE_HEADING}</th>')
    expect(HEAD).not.toContain('>ref_code<')

    const ROW = between(TABS, '{journeys.map((j) => {', '{formatDate(j.addedAt)}')
    expect(ROW).toContain('{personNameText(j.displayName)}')
    expect(ROW).not.toContain('不明')
  })

  it('重複のしるしの吹き出しに列名を出さない', () => {
    const FLAG = between(TABS, '{item.duplicateFlag ? (', '</td>')
    expect(FLAG).toContain('title={DUPLICATE_FLAG_TITLE}')
    expect(FLAG).not.toMatch(/identity_key/i)
  })
})

describe('登録メディア voJtX の使用箇所', () => {
  const LIST = between(
    read('contents/page.tsx'),
    '{usagesFor?.id === item.id && (',
    '</ul>',
  )

  it('表に無い種別を内部の記号のまま出さない', () => {
    expect(LIST).toContain('{mediaUsageKindText(u.refKind)}')
    // `?? u.refKind` に戻ると、表を足し忘れた種別が静かに漏れる。
    expect(LIST).not.toContain('?? u.refKind')
    expect(LIST).not.toContain('REF_KIND_LABELS')
  })
})

describe('マイルの発生元 MvZm5 / HIU5O', () => {
  it('履歴の発生元は「元の記録あり／なし」だけを出す', () => {
    const CELL = between(
      read('mileage/mileage-history-tab.tsx'),
      '{mileageSourceLabel(item.source)}',
      '</Td>',
    )
    expect(CELL).toContain('mileageSourceNoteText({')
    expect(CELL).not.toContain('調整元ID')
    expect(CELL).not.toContain('title={item.sourceReferenceId')
  })

  it('マイル明細の発生元も同じ言い方にする', () => {
    const CELL = between(
      read('mileage/friends/detail/page.tsx'),
      '{mileageSourceLabel(item.source)}',
      '</Td>',
    )
    expect(CELL).toContain('mileageSourceNoteText({')
    expect(CELL).not.toContain('調整元ID')
    expect(CELL).not.toContain('title={item.sourceReferenceId')
  })
})
