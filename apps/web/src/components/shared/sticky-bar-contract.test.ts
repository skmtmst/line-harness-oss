import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..', '..')
const BAR = fs.readFileSync(path.join(__dirname, 'sticky-bar.tsx'), 'utf8')
const CSS = fs.readFileSync(path.join(__dirname, 'sticky-bar.module.css'), 'utf8')

/**
 * **作成・編集画面の下の帯を、部品で1つにそろえる。**
 *
 * 設計 `bV5Vs`（シナリオ編集）と `XBkiQ`（保存した検索を編集）は
 * どちらも同じ形——**左端に赤い削除、中央に「キャンセル / 複製して保存 /
 * 変更を保存」、右端は空き。**
 *
 * **消す操作を保存の隣に置かない。** 隣にあると、押し間違いが
 * 「保存したつもりが消えていた」になる。離すのは見た目の好みではない。
 *
 * 画面ごとに帯を書くと、この距離がそのつど変わる。部品で固定する。
 */

function pages(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) pages(p, out)
    else if (e.name === 'page.tsx') out.push(p)
  }
  return out
}

/**
 * 画面が読み込んでいるものも一緒に見る（親フォルダの相対importも含む）。
 *
 * **帯は部品の中にあることがある。** `tags/edit` は
 * `components/friend-fields/edit-tag-page-v4.tsx` に、
 * `tags/marks/new` は `support-mark-editor.tsx` に本体がある。
 * `page.tsx` だけを読むと「帯が無い」ことになり、直しようがない。
 */
function readWithParts(file: string, depth = 0, seen = new Set<string>()): string {
  if (depth > 2 || seen.has(file)) return ''
  seen.add(file)
  let source: string
  try {
    source = fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  let combined = source
  // ★V8 の画面は src/v8 に一から書く（入口は @/v8 から読む）。そこも辿る。
  for (const m of source.matchAll(/from '@\/(components|app|lib|v8)\/([^']+)'/g)) {
    const base = path.join(SRC, m[1], m[2])
    for (const ext of ['.tsx', '.ts', '/index.tsx']) {
      if (fs.existsSync(base + ext)) {
        combined += readWithParts(base + ext, depth + 1, seen)
        break
      }
    }
  }
  for (const m of source.matchAll(/from '(\.\/|\.\.\/)([^']+)'/g)) {
    const base = path.join(path.dirname(file), m[1], m[2])
    for (const ext of ['.tsx', '.ts']) {
      if (fs.existsSync(base + ext)) {
        combined += readWithParts(base + ext, depth + 1, seen)
        break
      }
    }
  }
  return combined
}

/**
 * 転送だけの画面は数えない。
 *
 * **帯を置けないものを「まだ置いていない」と数えない。** `scoring/new` は
 * `/mileage/earning-rules/new` へ送るだけで、フォームも保存も無い。
 * 表に残すと永久に空にならず、見張りとして働かなくなる。
 */
function isRedirectOnly(source: string): boolean {
  return /\b(permanentRedirect|redirect)\(/.test(source) && !/<form|onSubmit|保存/.test(source)
}

const EDIT_PAGES = pages(path.join(SRC, 'app'))
  .map((p) => ({
    p: path.relative(path.join(SRC, 'app'), p).split(path.sep).join('/'),
    s: readWithParts(p),
    own: fs.readFileSync(p, 'utf8'),
  }))
  .filter((f) => /\/(new|edit)\/page\.tsx$/.test(f.p))
  .filter((f) => !isRedirectOnly(f.own))

/**
 * **まだ帯を使っていない作成・編集画面。減る一方の表。**
 *
 * 帯へ寄せるのは画面ごとの作業（共通部品の作業では機能の画面を触らない）。ここは**増やせないこと**
 * だけを見張る。使い始めたら行ごと消す——消し忘れるとこの試験が落ちる。
 *
 * 2026-09-04: 24 画面と数えていたが、**数え方が2つ間違っていた**（台帳 #109）。
 *   転送するだけの画面（`accounts/new` `scoring/new`）を数えていた。
 *     置けないものを「まだ置いていない」と数えると、表が永久に空にならない。
 *   帯が部品の中にある画面（`tags/edit` `tags/marks/*` `events/new`
 *     `templates/edit`）を「無い」と数えていた。`page.tsx` だけ読んでいたため。
 * 読み込んだ部品まで見て数え直すと17画面で、そのうち3画面を #856 で移行した。
 * 残る14画面は台帳 #109 の仕上げ（PR #866）で共通バーへ移し、この表を空にした。
 */
const NOT_YET: string[] = []

// アカウント登録は保存フォームの帯ではなく、5段のウィザードの進む操作を使う。
const WIZARD_PAGES = new Set(['accounts/new/page.tsx'])
const uses = (s: string) => /StickyBar|CreatePage/.test(s)

describe('下部追従バーの並びを部品で固定する', () => {
  it('作成・編集画面を読めている', () => {
    expect(EDIT_PAGES.length).toBeGreaterThanOrEqual(30)
  })

  it('帯を使っていない画面を増やさない', () => {
    const found = EDIT_PAGES.filter((f) => !WIZARD_PAGES.has(f.p) && !uses(f.s)).map((f) => f.p).sort()
    expect(found, '作成・編集画面が自前で帯を書いている').toEqual([...NOT_YET].sort())
  })

  it('登録ウィザードの進む操作と接続確認の保存制限を残す', () => {
    const wizard = readWithParts(path.join(SRC, 'app/accounts/new/page.tsx'))
    expect(wizard).toContain('V8_STEPS')
    expect(wizard).toContain('type="submit"')
    expect(wizard).toContain('!connectionPassed')
    expect(wizard).toContain('api.lineAccounts.connect(')
  })

  it('削除は左端、ほかは中央、右端は空ける', () => {
    // 3列にして真ん中を auto にする。`space-between` だと、削除が無い画面で
    // 操作が左へ寄ってしまう。
    expect(CSS).toMatch(/grid-template-columns:\s*1fr auto 1fr/)
    expect(CSS).not.toMatch(/justify-content:\s*space-between/)
    expect(CSS).toMatch(/\.actions\s*\{[^}]*justify-content:\s*center/s)
    // 削除は専用の口で受ける。状態の文字と同じ口に入れない。
    expect(BAR).toMatch(/destructive\?:\s*ReactNode/)
    expect(BAR).toMatch(/\{destructive\}/)
  })

  it('状態の文字は無くてよい', () => {
    // 設計の2画面（bV5Vs・XBkiQ）はどちらも状態の文字を持たない。
    expect(BAR).toMatch(/status\?:\s*ReactNode/)
    expect(BAR).toMatch(/status \? </)
  })

  /*
   * ★BG-B の帯は 左=残り枚数／中=サイズ／右=ボタン（`WDJak`「中 サイズ確認」）。
   * 読むだけの一言を操作の手前に置ける口を足した。渡さない画面は
   * 左=状態／中央=操作／右端=空きのままなので、ほかの作成・編集画面の
   * 見た目は変わらない。
   *
   * 2026-10-07 の2度目の差し戻し（この見張り自体を直した）: はじめは
   * 4列（`1fr auto auto 1fr`）にして右端へ空き列を残していた。しかし
   * 承認済み ★BG-B `qIp42` の帯 `X2oLn` は右の列 `J94Yj` が
   * `fill_container` ＋ `justifyContent: end` で、**ボタンが帯の右端に付く**。
   * 4列だと操作が中央寄りになって絵と違ったため、3列目を操作そのものにして
   * 右そろえへ変えた。空き列へ戻すとこの試験が落ちる。
   */
  it('操作の手前の一言を渡した画面は、ボタンを右端に置く', () => {
    expect(BAR).toMatch(/info\?:\s*ReactNode/)
    expect(BAR).toMatch(/info \? </)
    // 列は3つのまま。3列目が操作で、中身を右へ寄せる。
    expect(CSS).toMatch(/\.withInfo\s*\{[^}]*grid-template-columns:\s*1fr auto 1fr/s)
    expect(CSS).toMatch(/\.withInfo \.actions\s*\{[^}]*justify-content:\s*flex-end/s)
    // 右端に空き列を作る4列へ戻していないこと。
    expect(CSS).not.toMatch(/1fr auto auto 1fr/)
  })

  /*
   * 2026-10-07: `GcuH5` を薄い文字で出していて絵と違った（差し戻し）。
   * 直し方は「帯に色を足す」ではなく「札の部品を渡す」。帯は40画面以上で
   * 共有していて、ここへ色を埋めると関係のない画面まで緑になる。
   */
  it('一言の置き場所だけを持ち、画面ごとの見た目は埋めない', () => {
    const info = CSS.match(/\.info \{([^}]*)\}/s)?.[1] ?? ''
    expect(info, '.info の規定が無い').not.toBe('')
    expect(info).not.toMatch(/background/)
    expect(info).not.toMatch(/border-radius/)
    expect(info).not.toMatch(/--color-accent/)
    expect(info).not.toMatch(/font-size/)
    // 札は中身の部品が描く。帯がアイコンを持たない。
    expect(BAR).not.toMatch(/lucide-react/)
  })

  it('一言を渡さない画面は、今までどおり右端を空ける', () => {
    // 一言は `actions` の前（押す前に読ませる）。
    expect(BAR.indexOf('{info ?')).toBeLessThan(BAR.indexOf('styles.actions'))
    // 右端の空き箱は残す。ただし一言を渡した画面では作らない
    // （`X2oLn` どおりボタンが右端に付くため。上の試験とひと組）。
    expect(BAR).toMatch(/info \? null : <div aria-hidden="true"/)
  })

  it('1440 で横スクロールさせずに折り返す', () => {
    expect(CSS).toMatch(/@media \(max-width: 1100px\)/)
  })

  it('画面の下に追従する', () => {
    expect(CSS).toMatch(/position:\s*sticky/)
    // v7 の土台は画面の下端に付けるまま。
    expect(CSS).toMatch(/\.bar \{\s*position:\s*sticky;\s*bottom:\s*0;/s)
  })

  it('★A の浮かせ（V8 は下から 12px・枠なし・ふんわり影・角丸そのまま）', () => {
    const v8 = CSS.match(/\[data-theme='v8'\] \.bar \{([^}]*)\}/s)?.[1] ?? ''
    expect(v8, 'V8 の .bar の規定が無い').not.toBe('')
    expect(v8).toMatch(/bottom:\s*12px/)
    expect(v8).toMatch(/border:\s*0/)
    expect(v8).toMatch(/box-shadow:\s*var\(--shadow-bar-float\)/)
    // 角丸は変えない（上書きが無い）。
    expect(v8).not.toMatch(/border-radius/)
    // 並びは変えない（3列・中央寄せの決まりは別の試験が守る）。
    expect(v8).not.toMatch(/grid-template-columns/)
  })
})
