import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EFFECTIVE_LEGEND,
  LOAD_STATE_WORDS,
  MESSAGE_KIND_WORDS,
  NO_WRITE_PERMISSION,
  UNNAMED_ACCOUNT,
  actionWord,
  effectiveAccountWord,
  matchTypeWord,
  messageKindWord,
  metricWord,
  responseTypeWord,
  templateWord,
} from './auto-reply-words'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')
const PAGE = read('page.tsx')
const WORDS = read('auto-reply-words.ts')
const DIALOG = read('..', '..', 'components', 'shared', 'dialog.tsx')
const CONFIRM = read('..', '..', 'components', 'shared', 'confirm-dialog.tsx')

/**
 * 画面に出してはいけない、作った側の言葉と保存してある値。
 *
 * `silent` `flex` `image` `text` `inline` は**返した文字の中に**混じって
 * いないかを見る。コード側の `r.responseType === 'silent'` のような比較は
 * 混じらないので、ここは**関数の返り値だけ**を相手にする。
 */
const INTERNAL_TOKENS = [
  'silent',
  'flex',
  'image',
  'inline',
  'automation',
  'match',
  'keyword',
  'template_id',
  'line_account_id',
  'not_applicable',
  'null',
  'undefined',
]

function expectNoInternalWord(text: string) {
  const lower = text.toLowerCase()
  for (const token of INTERNAL_TOKENS) {
    expect(lower, `「${text}」に内部語 ${token} が残っています`).not.toContain(token)
  }
  // 保存してある値がそのまま出ていないか。小文字が並ぶ形は保存値を疑う
  // （`LINE` のような商品名は大文字なので、これには当たらない）。
  expect(text, `「${text}」に英字の値が出ています`).not.toMatch(/[a-z]{4,}/)
}

describe('自動応答の一覧に出す言葉（内部語の置き換え表）', () => {
  it('返し方の内部コードを、運用者の言葉にする', () => {
    expect(responseTypeWord('silent').label).toBe('返信しない')
    expect(responseTypeWord('silent').note).toBe('返信内容が設定されていないため、何もしません')
    expect(responseTypeWord('text').label).toBe('テキスト')
    expect(responseTypeWord('image').label).toBe('画像')
    expect(responseTypeWord('flex').label).toBe('カード')
  })

  it('知らない返し方でも、保存してある値をそのまま出さない', () => {
    for (const unknown of ['sticker', 'template_carousel', 'imagemap', 'ZZZ']) {
      const word = responseTypeWord(unknown)
      expect(word.label).toBe('未対応の返し方')
      expect(`${word.label}${word.note}`).not.toContain(unknown)
    }
  })

  it('返し方の言葉に、内部語が混じらない', () => {
    for (const code of ['silent', 'text', 'image', 'flex', 'なにか']) {
      const word = responseTypeWord(code)
      expectNoInternalWord(word.label)
      expectNoInternalWord(word.note)
    }
  })

  it('キーワードの見かたを、作った側の言い方で書かない', () => {
    expect(matchTypeWord('exact')).toBe('完全一致')
    expect(matchTypeWord('contains')).toBe('部分一致')
    expect(matchTypeWord('contains')).not.toBe('包含')
  })

  it('テンプレートを使わないルールに (inline) と出さない', () => {
    const word = templateWord(null, null)
    expect(word.label).toBe('この設定に直接入力')
    expect(word.linked).toBe(false)
    expectNoInternalWord(word.label)
    expectNoInternalWord(word.note)
  })

  it('テンプレートの名前が引けるときは、その名前とリンクを出す', () => {
    const word = templateWord('tpl_0001', '営業時間外のご案内')
    expect(word.label).toBe('営業時間外のご案内')
    expect(word.linked).toBe(true)
  })

  /** 断片でも運用の役に立たないうえ、画面写真に載って外へ出る。 */
  it('テンプレートの名前が引けなくても、IDの断片を出さない', () => {
    const id = 'a1b2c3d4-5e6f-4708-9a0b-1c2d3e4f5a6b'
    const word = templateWord(id, null)
    expect(word.linked).toBe(false)
    for (const part of [id, id.slice(0, 6), id.slice(0, 8), id.slice(0, 4)]) {
      expect(`${word.label}${word.note}`).not.toContain(part)
    }
    expect(word.label).toBe('テンプレートを表示できません')
  })

  it('名前を引けないアカウントにも、IDの断片を出さない', () => {
    expect(UNNAMED_ACCOUNT.label).toBe('表示できないアカウント')
    expectNoInternalWord(UNNAMED_ACCOUNT.label)
    expectNoInternalWord(UNNAMED_ACCOUNT.note)
  })

  it('適用アカウントの3状態を、何が起きるかで書く', () => {
    expect(effectiveAccountWord('reply', 'inline').note).toContain('このアカウントで返信します')
    expect(effectiveAccountWord('reply', 'automation').note).toContain('つないである別の設定')
    expect(effectiveAccountWord('silent', null).note).toContain('返信内容が設定されていないため')
    expect(effectiveAccountWord('not_applicable', null).note).toContain('別のアカウント専用')
  })

  it('適用アカウントの言葉に、DBの列名や内部語が混じらない', () => {
    const cases = [
      effectiveAccountWord('reply', 'inline'),
      effectiveAccountWord('reply', 'automation'),
      effectiveAccountWord('silent', null),
      effectiveAccountWord('not_applicable', null),
    ]
    for (const word of cases) expectNoInternalWord(word.note)
  })

  it('凡例は札の3種類と1対1で並び、内部語を持たない', () => {
    expect(EFFECTIVE_LEGEND.map((row) => row.status)).toEqual([
      'reply',
      'silent',
      'not_applicable',
    ])
    for (const row of EFFECTIVE_LEGEND) expectNoInternalWord(row.text)
  })

  it('知らないアクションでも、保存してある値をそのまま出さない', () => {
    expect(actionWord('tag')).toBe('タグ')
    expect(actionWord('common_var')).toBe('共通情報')
    expect(actionWord('rich_menu_switch')).toBe('その他の処理')
    expectNoInternalWord(actionWord('rich_menu_switch'))
  })

  /**
   * 編集画面にも同じ表がある（`edit-dialog.tsx`）。設計の語がその画面に
   * あるかを見る試験（`design-structure`）が、あちらの直書きを読んでいる
   * ため1つにまとめられない。**ずれたらここで落とす。**
   */
  it('編集画面のメッセージ種別と、一覧の言い換えがずれない', () => {
    const EDIT = read('..', '..', 'components', 'auto-replies', 'edit-dialog.tsx')
    const start = EDIT.indexOf('const MESSAGE_KIND_LABELS')
    expect(start, '編集画面の MESSAGE_KIND_LABELS が見つかりません').toBeGreaterThan(-1)
    const block = EDIT.slice(start, EDIT.indexOf('\n]', start))
    const pairs = [...block.matchAll(/\{ key: '([a-z_]+)', label: '([^']+)' \}/g)]
    expect(pairs.map((m) => ({ key: m[1], label: m[2] }))).toEqual([...MESSAGE_KIND_WORDS])
  })

  it('メッセージ種別も日本語で出し、知らない値は値のまま出さない', () => {
    expect(messageKindWord('text')).toBe('テキスト')
    expect(messageKindWord('postback')).toBe('ボタンのタップ')
    expect(messageKindWord('imagemap')).toBe('その他のメッセージ')
    for (const kind of MESSAGE_KIND_WORDS) expectNoInternalWord(kind.label)
  })
})

describe('読み込みの状態を言い分ける', () => {
  it('読込中・取得失敗・権限不足の言い方を混ぜない', () => {
    expect(LOAD_STATE_WORDS.loading.label).toBe('読み込んでいます')
    expect(LOAD_STATE_WORDS.error.label).toBe('読み込めませんでした')
    expect(LOAD_STATE_WORDS.forbidden.label).toBe('見る権限がありません')
    expect(NO_WRITE_PERMISSION.label).toBe('操作する権限がありません')
    const all = Object.values(LOAD_STATE_WORDS).map((w) => w.label)
    expect(new Set(all).size).toBe(all.length)
  })

  it('数えられていないときに 0 と書かない', () => {
    expect(metricWord('ready', 0)).toBe('0')
    expect(metricWord('ready', 12)).toBe('12')
    expect(metricWord('loading', 0)).toBe('—')
    expect(metricWord('error', 12)).toBe('—')
    expect(metricWord('forbidden', 12)).toBe('—')
  })
})

describe('一覧の画面が置き換え表を通す', () => {
  it('言い換えは純粋関数の側だけが持つ（画面に表を作り直さない）', () => {
    expect(PAGE).toContain("} from './auto-reply-words'")
    expect(WORDS).not.toContain("from 'react'")
    expect(PAGE).not.toContain('const matchTypeLabel')
    expect(PAGE).not.toContain('const ACTION_SUMMARY_LABELS')
  })

  it('内部コードと内部IDの断片を画面に書かない', () => {
    for (const banned of [
      '(inline)',
      '(未知 ',
      'line_account_id',
      'automation 経由',
      'automation rule',
      'silent rule',
      '適用外 (',
      '返信あり (',
      'match するが返信なし',
      '.slice(0, 6)',
      '.slice(0, 8)',
      '>template<',
      '包含',
    ]) {
      expect(PAGE, `画面に「${banned}」が残っています`).not.toContain(banned)
    }
  })

  it('読み込みの言い方を画面でも混ぜない', () => {
    expect(PAGE).toContain('LOAD_STATE_WORDS[loadState]')
    expect(PAGE).toContain('再読み込み')
    expect(PAGE).toContain("reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error'")
    expect(PAGE).not.toContain('読み込みに失敗しました')
    expect(PAGE).not.toContain('読み込み中...')
    expect(PAGE).not.toContain('自動返信ルールがありません')
  })

  it('読めていないときに件数を 0 と出さない', () => {
    expect(PAGE).toContain('metricWord(loadState, items.length)')
    expect(PAGE).toContain('metricWord(loadState, monthlyHits)')
    expect(PAGE).toContain('metricWord(loadState, timeRestrictedCount)')
    expect(PAGE).toContain('metricWord(loadState, neverHitCount)')
  })

  it('開く先が無いテンプレートをリンクにしない', () => {
    expect(PAGE).toContain('if (!word.linked)')
  })
})

describe('削除確認 Gy9OK の絵と、押せる形', () => {
  it('見出しの左に警告22px、削除ボタンの中にごみ箱16pxを置く', () => {
    expect(PAGE).toContain("import { Trash2, TriangleAlert } from 'lucide-react'")
    expect(PAGE).toContain('titleIcon={<TriangleAlert size={22} />}')
    expect(PAGE).toContain('confirmIcon={<Trash2 size={16} />}')
  })

  it('共通ダイアログが絵の口を持つ（渡さなければ今までどおり）', () => {
    expect(CONFIRM).toContain('titleIcon?: ReactNode')
    expect(CONFIRM).toContain('confirmIcon?: ReactNode')
    expect(DIALOG).toContain('titleIcon?: ReactNode')
    expect(DIALOG).toContain('confirmIcon?: ReactNode')
    expect(DIALOG).toContain('{titleIcon ? (')
    expect(DIALOG).toContain('{!busy && confirmIcon ?')
  })

  /** 手本どおりの3点。ここは変えない。 */
  it('何が止まり・何が残り・戻せないことを、これまでどおり読ませる', () => {
    expect(PAGE).toContain('新しく届くメッセージへの自動返信')
    expect(PAGE).toContain('タグ付けなどの後続処理が止まります')
    expect(PAGE).toContain('過去の実行履歴は削除されません')
    expect(PAGE).toContain('この操作は元に戻せません')
  })

  it('消せない状態では確認のボタンを出さず、理由を本文に出す', () => {
    expect(PAGE).toContain('const deleteTargetStale =')
    expect(PAGE).toContain('onConfirm={deleteTargetStale ? undefined : () => void handleDelete()}')
    expect(PAGE).toContain('{deleteTargetStale && (')
    expect(PAGE).toContain('削除する自動応答を選び直してください')
  })

  it('権限で断られたときに、読み直せとは書かない', () => {
    expect(PAGE).toContain('reason instanceof ApiError && reason.status === 403')
    expect(PAGE).toContain('NO_WRITE_PERMISSION.label')
  })
})
