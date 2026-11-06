import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..', '..')

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
 * `v8/tag-edit/edit-form.tsx` に、
 * `tags/marks/new` は `v8/tags/mark-editor.tsx` に本体がある。
 * `page.tsx` だけを読むと「帯が無い」ことになり、直しようがない。
 */
function readWithParts(file: string, depth = 0, seen = new Set<string>()): string {
  if (depth > 8 || seen.has(file)) return ''
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

// アカウント登録はウィザード、V8のフォルダ作成は共通窓の確定操作を使う。
const NON_FORM_PAGES = new Set(['accounts/new/page.tsx', 'tags/folders/new/page.tsx'])
const uses = (s: string) => /StickyBar|CreatePage/.test(s)

describe('下部追従バーの並びを部品で固定する', () => {
  it('作成・編集画面を読めている', () => {
    expect(EDIT_PAGES.length).toBeGreaterThanOrEqual(30)
  })

  it('帯を使っていない画面を増やさない', () => {
    const found = EDIT_PAGES.filter((f) => !NON_FORM_PAGES.has(f.p) && !uses(f.s)).map((f) => f.p).sort()
    expect(found, '作成・編集画面が自前で帯を書いている').toEqual([...NOT_YET].sort())
  })

  it('登録ウィザードの進む操作と接続確認の保存制限を残す', () => {
    const wizard = readWithParts(path.join(SRC, 'app/accounts/new/page.tsx'))
    expect(wizard).toContain('V8_STEPS')
    expect(wizard).toContain('type="submit"')
    /* 接続確認の保存制限は v06 で手動チェックから5行の確認へ変わった。
       文字で見張らず、描いた画面で見張る：
       register-v8.react.test.tsx「5行が通ってから登録でき、登録すると③Step2へ進む」。 */
    expect(wizard).toContain('api.lineAccounts.connect(')
  })

  it('フォルダ作成は共通窓の確定とキャンセルへ接続する', () => {
    const source = readWithParts(path.join(SRC, 'app/tags/folders/new/page.tsx'))
    expect(source).toContain('<FolderEditorDialog')
    expect(source).toMatch(/onConfirm=\{(?:save|\(\) => save\(\))\}/)
    expect(source).toContain('onCancel={close}')
  })

  // 操作の位置・影・追従は shared-surface-layout.test.mjs の実描画と故障対照で検査する。
})
