import { readFileSync } from 'node:fs'
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

  it('行の右端に出すのは編集ボタンと「…」だけ', () => {
    expect(page).toContain("import ActionMenu")
    expect(page).toContain("MoreAction")
    // 行内に文字のリンクを何個も並べない（3段に折れる原因）。
    expect(page).not.toMatch(/>\s*一斉配信で使う\s*<\/a>/)
    expect(page).not.toMatch(/>\s*テンプレートを削除\s*<\/button>/)
    expect(page).toContain('whitespace-nowrap')
    expect(page).toContain('aria-expanded={openRowMenuId === t.id}')
  })

  it('副操作はメニュー項目として渡す', () => {
    expect(page).toContain("label: '一斉配信で使う'")
    expect(page).toContain("label: '使用先を見る'")
    expect(page).toContain("label: 'テンプレートを削除'")
    expect(page).toContain("tone: 'danger'")
  })
})

describe('U044: 767px以下ではテンプレート一覧をカードへ畳む', () => {
  const page = read('templates/page.tsx')
  const styles = read('templates/templates-v6.module.css')

  it('表のマークアップは残し、CSSでカードに変える', () => {
    expect(page).toContain('data-template-list')
    expect(styles).toContain('[data-template-list]')
    expect(styles).toContain('@media (max-width: 767.98px)')
    expect(styles).toMatch(/\[data-template-list\] tbody tr \{\s*display: flex/)
    expect(styles).toMatch(/\[data-template-list\] thead \{\s*display: none/)
    expect(styles).toMatch(/\[data-template-list\] table \{\s*min-width: 0/)
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
  it('単位はラベルではなく入力の右隣', () => {
    expect(page).not.toContain('所要時間（分）')
    expect(page).not.toContain('後の空き時間（分）')
    for (const unit of ['分', '円', '件', '時間前', '日先まで']) {
      expect(page).toContain(`>${unit}<`)
    }
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
  it('共有部品の SelectField には触らず、画面側の属性スコープで幅を上書きする', () => {
    // shared/ は Claude 所有領域。size="full" のような部品改変はしない。
    const component = read('../components/shared/select-field.tsx')
    expect(component).not.toContain("'full'")
    const operator = read('line-notifications/operator/new/page.tsx')
    expect(operator).not.toContain('size="full"')
    expect(operator).toContain('data-selects-wide')
    expect(operator).toContain('[data-selects-wide] select { width: 100%; }')
  })
  it('共通アクションの見本選択は内容に合わせて広がる', () => {
    const page = read('common-actions/new/page.tsx')
    expect(page).toContain('data-example-select')
    expect(page).toContain('[data-example-select] select { width: auto; max-width: 100%; }')
  })
  it('特典の選択は部品が持つ full 指定を使う（Select側は既存のprop）', () => {
    const rewards = read('mileage/rewards/edit/page.tsx')
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
