import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * Issue #975（UI監査の修正まとめ）のうち、テンプレート・フォーム・
 * 作成画面の構造を固定する契約。見た目の一致は別途スクリーンショットで
 * 確かめるので、ここでは「並び・部品・クラス」の約束だけを見る。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('U043: テンプレート行の操作は「編集」と「…」メニューにまとめる', () => {
  const page = read('templates/page.tsx')

  it('副操作はメニュー項目として渡す', () => {
    expect(page).toContain("label: '一斉配信で使う'")
    expect(page).toContain("label: '使用先を見る'")
    expect(page).toContain("label: 'テンプレートを削除する'")
    expect(page).toContain("tone: 'danger'")
  })
})

describe('U044: 767px以下ではテンプレート一覧をカードへ畳む', () => {
  const page = read('templates/page.tsx')
  const styles = read('templates/templates-v6.module.css')

  /*
   * ★V7 監査の直し A（`LD96g`・m18c）で書き換え。以前の「表のままCSSで
   * 畳む」形は、名前欄の `max-w-0` が残ってスマホで名前が消える原因だった。
   * 共通の一覧カード（`MobileTableCards`・767px以下だけ）に任せ、表は
   * 768px 以上だけ出す。見た目の固定の書き換えで、動きの約束は変えない。
   */
  it('表のマークアップは残し、767px以下は共通カードに任せる', () => {
    expect(page).toContain('MobileTableCards')
    expect(page).toContain('hidden md:block')
    expect(page).not.toContain('data-template-list')
    expect(styles).not.toContain('[data-template-list]')
    expect(styles).not.toMatch(/^\s*:global\(/m)
  })
})

describe('U054: 作成画面の余白を二重に取らない', () => {
  it('webinars/new の外側に左右余白を足さない', () => {
    const page = read('webinars/new/page.tsx')
    expect(page).not.toContain('max-w-screen-2xl px-6')
  })
  it('analytics/reports/new の外側に左右余白を足さない', () => {
    const page = read('analytics/reports/new/page.tsx')
    expect(page).not.toContain('max-w-screen-2xl px-6')
  })
  it('analytics/reports/new のカード内余白は狭い画面で16pxに落とす', () => {
    const page = read('analytics/reports/new/page.tsx')
    expect(page).toContain('rounded-card border p-4 sm:p-6')
  })
  it('U054の解決に共有部品（CreatePage）は触らない', () => {
    // shared/ は Claude 所有領域。画面側の局所解決だけで直す。
    const shared = read('../components/shared/create-page.tsx')
    expect(shared).toContain("'rounded-card space-y-5 p-6'")
  })
})

describe('U055: 予約メニューの数値欄は1列に積み、単位を値の右へ置く', () => {
  const page = read('booking/menus/new/page.tsx')

  it('狭い画面では1列', () => {
    expect(page).toContain('grid-cols-1 gap-4 sm:grid-cols-2')
  })
})

describe('U056: 長文欄ははじめから3行分の高さ', () => {
  it('イベントの説明と質問の返信は rows=3 以上', () => {
    const wizard = read('../components/events/event-wizard.tsx')
    const editor = read('../components/scenarios/question-editor.tsx')
    expect(wizard).not.toContain('rows={2}')
    expect(editor).not.toContain('rows={2}')
    expect(wizard).toMatch(/id="ev-desc"[\s\S]*?rows=\{3\}/)
  })
})

describe('U057: 質問テンプレートの置き場は1つの選択だけ', () => {
  const page = read('templates/questions/new/page.tsx')

  it('「フォルダ」の自由記入欄を置かない', () => {
    expect(page).not.toContain('datalist')
    expect(page).not.toContain('question-template-folders')
    // 置き場の選択肢だけが残る。
    expect(page).toContain('aria-label="置き場"')
    // 置き場を選ぶと保存値（category）へも同じ名前を入れる。
    expect(page).toContain('setCategory(folders.find')
  })
})

describe('U058: 差し込み操作は本文の欄より後に置く', () => {
  it('メッセージ編集は本文Fieldの後に差し込み群', () => {
    const editor = read('../components/templates/message-template-editor.tsx')
    const body = editor.indexOf('label={contentLabel}')
    const insert = editor.indexOf('<TemplateInsertControls')
    expect(body).toBeGreaterThan(-1)
    expect(insert).toBeGreaterThan(body)
  })
  it('自動返信は返信文のtextareaの後に差し込みボタン', () => {
    const dialog = read('../components/auto-replies/edit-dialog.tsx')
    const textarea = dialog.indexOf('返信する内容を入力')
    const insert = dialog.indexOf('差し込み項目')
    expect(textarea).toBeGreaterThan(-1)
    expect(insert).toBeGreaterThan(textarea)
  })
})

describe('U063: 長い選択肢のプルダウンは欄いっぱいに広げる', () => {
  it('運用者通知の選び欄は欄いっぱいに広げる（部品の full 指定）', () => {
    // 選び欄は Select 1 本化済み。幅は部品の size="full" で持たせる。
    const operator = read('line-notifications/operator/new/operator-new-v8.tsx')
    expect(operator.match(/size="full"/g)?.length).toBeGreaterThanOrEqual(7)
    expect(operator).not.toContain('[data-selects-wide] select')
  })
  it('共通アクションの見本選択は内容に合わせて広がる', () => {
    const page = read('common-actions/new/page.tsx')
    expect(page).toContain('data-example-select')
    expect(page).toContain('[data-example-select] .min-w-48 { width: auto; max-width: 100%; }')
  })
  it('特典の選択は部品が持つ full 指定を使う（Select側は既存のprop）', () => {
    /* 入口は V8 の画面（src/v8/mileage/reward-edit.tsx）を出すだけ。選ぶ欄はそちらにある。 */
    const rewards = read('../v8/mileage/reward-edit.tsx')
    expect(rewards.match(/size="full"/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('U100: 登録フォームのラベルは補足に潰されない', () => {
  it('ラベルと補足は縦に積む', () => {
    const card = read('../components/auth/auth-card.tsx')
    // ラベルと補足を同じ flex 行へ入れない。
    expect(card).not.toMatch(/<div className="flex items-center gap-1.5">[\s\S]*?<label[\s\S]*?<span className="text-micro/)
  })
})
