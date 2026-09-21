import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Issue #1013 / 監査 ATTR-01,05,06,09,10,12,13,18 の修正を固定する契約試験。
 * 画面の見た目ではなく「以前の壊れ方が戻っていないか」を見る。
 */

const root = resolve(process.cwd(), 'src')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const FIELD_LIST = read('components/friend-fields/field-list.tsx')
const MARK_LIST = read('components/friend-fields/mark-list.tsx')
const MARK_EDITOR = read('components/friend-fields/support-mark-editor.tsx')
const SEARCH_LIST = read('components/friend-fields/saved-search-list.tsx')
const SEARCH_EDIT = read('app/tags/searches/edit/page.tsx')
const MIGRATE = read('app/tags/fields/migrate/page.tsx')
const CSV_DIALOG = read('components/friend-fields/tag-csv-import-dialog.tsx')
const CSV_CSS = read('components/friend-fields/tag-csv-import-dialog.module.css')
const GATE = read('lib/latest-request.ts')

describe('ATTR-01: アカウント切替で古い応答・古いダイアログを残さない', () => {
  it('情報欄・対応マークの一覧は要求世代とアカウントを照合してから反映する', () => {
    for (const source of [FIELD_LIST, MARK_LIST]) {
      expect(source).toContain('createResponseGate')
      expect(source).toContain('gateRef.current.current(token)')
      expect(source).toContain('accountRef.current !== account')
    }
  })

  it('切替時に削除・保管確認と掴み中の行を閉じる', () => {
    expect(FIELD_LIST).toContain('setPendingDelete(null)')
    expect(FIELD_LIST).toContain('setDragId(null)')
    expect(MARK_LIST).toContain('setPendingDelete(null)')
    expect(MARK_LIST).toContain('setArchiveImpact(null)')
    expect(SEARCH_LIST).toContain('setPendingDelete(null)')
  })

  it('保管の影響確認も古い応答を反映しない', () => {
    const openArchive = MARK_LIST.slice(MARK_LIST.indexOf('const openArchive'))
    expect(openArchive).toContain('gateRef.current.begin()')
    expect(openArchive).toContain('gateRef.current.current(token)')
  })
})

describe('ATTR-05: 既存の情報欄を編集できる入口がある', () => {
  it('一覧の項目名が編集画面へのリンクになっている', () => {
    expect(FIELD_LIST).toContain('/tags/fields/edit?id=')
  })

  it('編集ページがあり、種類と差し込み名は変更しない', () => {
    expect(existsSync(resolve(root, 'app/tags/fields/edit/page.tsx'))).toBe(true)
    const page = read('app/tags/fields/edit/page.tsx')
    // 種類・キーの入力欄は作らない。表示だけ。
    expect(page).toContain('差し込み名（変更できません）')
    expect(page).toContain('種類（変更できません）')
    expect(page).not.toMatch(/onChange=.*setFieldKey/)
    // 変更できる項目: 名前・選択肢・既定値・保護・使用状況
    for (const label of ['項目名', '既定値', '個人情報として保護', 'EC側を正とする']) {
      expect(page).toContain(label)
    }
    // 他の人の先勝ちを黙って潰さない。読んだ版をサーバーへ送る。
    expect(page).toContain('version: field.version')
    expect(page).toContain('api.friendFields.update(')
  })
})

describe('ATTR-06: マーク作成と自動ルールの有効化を分ける', () => {
  it('新規作成の初期状態では自動ルールを送らない', () => {
    // 以前は useState(true) で、何もしなくても有効なルールが作られた。
    expect(MARK_EDITOR).toContain('const [createRule, setCreateRule] = useState(false)')
    expect(MARK_EDITOR).not.toContain('const [createRule, setCreateRule] = useState(true)')
    // 利用者が「＋ ルールを追加」を押したときだけルールを作る。
    expect(MARK_EDITOR).toContain('＋ ルールを追加')
    expect(MARK_EDITOR).toContain('ルールを外す')
    // 有効化も利用者が選ぶ（外せる・無効のまま登録できる）。
    expect(MARK_EDITOR).toContain('このルールを有効にして登録する')
    expect(MARK_EDITOR).toContain('isActive: ruleActive')
  })
})

describe('ATTR-09/10: 移行は事前確認のあと明示実行し、古い確認を断る', () => {
  it('確認済みの証票と冪等キーで実行口を呼ぶ', () => {
    expect(MIGRATE).toContain('api.friendFields.migrationExecute(')
    expect(MIGRATE).toContain('preview.previewToken')
    expect(MIGRATE).toContain('crypto.randomUUID()')
    expect(MIGRATE).toContain('移行を実行する')
    expect(MIGRATE).toContain('api.friendFields.migrationRun(')
  })

  it('確認前・実行中は実行ボタンを出さない', () => {
    expect(MIGRATE).toContain('confirmed && !run')
    expect(MIGRATE).toContain('disabled={executing || running}')
  })

  it('条件変更・アカウント切替で飛んでいる確認を無効にする', () => {
    expect(MIGRATE).toContain('createResponseGate')
    expect(MIGRATE).toContain('resetConfirmation')
    expect(MIGRATE).toContain('gateRef.current.invalidate()')
  })
})

describe('ATTR-12/13: 保存検索の再計算と演算子の整合', () => {
  it('再計算は要求世代で照合し、条件変更で無効化する', () => {
    expect(SEARCH_EDIT).toContain('createResponseGate')
    expect(SEARCH_EDIT).toContain('gateRef.current.current(token)')
    expect(SEARCH_EDIT).toContain('gateRef.current.invalidate()')
    // 失敗・古い・未取得を分ける。黙って null へ戻さない。
    expect(SEARCH_EDIT).toContain('previewError')
    expect(SEARCH_EDIT).toContain('人数を計算できませんでした')
  })

  it('画面の演算子は保存・実行側と同じ表で確かめる', () => {
    expect(SEARCH_EDIT).toContain('isSavedSearchOpAllowed')
    expect(SEARCH_EDIT).toContain('isSavedSearchValueOptionalOp')
    // 「登録あり／なし」「大小比較」を画面から作れる（以前は保存済みだけが持てた）。
    for (const op of ["'not_contains'", "'gte'", "'lte'", "'exists'", "'not_exists'"]) {
      expect(SEARCH_EDIT).toContain(`value: ${op}`)
    }
  })
})

describe('ATTR-18: CSVダイアログの操作が390pxで切れない', () => {
  it('本文だけがスクロールし、操作列は常に出る', () => {
    expect(CSV_CSS).toContain('.body {')
    expect(CSV_CSS).toMatch(/\.body\s*\{[^}]*overflow-y:\s*auto/)
    expect(CSV_DIALOG).toContain('className={styles.body}')
    // 固定 height + overflow:hidden でボタンごと切る形へ戻さない。
    // `max-height:` は上限なので許す。戻してはいけないのは `height:` 単体。
    for (const cls of ['selectPanel', 'previewPanel', 'partialPanel', 'successPanel']) {
      expect(CSV_CSS, `.${cls} に固定 height を戻さない`).not.toMatch(new RegExp(`\\.${cls}\\s*\\{[^}]*(?:^|[\\s;{])height:`, 'm'))
      expect(CSV_CSS, `.${cls} は上限だけ決める`).toContain(`max-height: min(`)
    }
  })
})

describe('共通: 世代管理ユーティリティ', () => {
  it('要求の印・照合・無効化の3つを持つ', () => {
    expect(GATE).toContain('begin()')
    expect(GATE).toContain('current(token')
    expect(GATE).toContain('invalidate()')
  })
})
