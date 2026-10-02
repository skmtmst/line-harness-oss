import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const EDIT = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const NEW = readFileSync(join(HERE, 'new', 'page.tsx'), 'utf8')
const EDITOR = readFileSync(join(HERE, '..', '..', 'components', 'automations', 'common-action-editor.tsx'), 'utf8')

/*
 * m26l: 共通アクションの作成・編集で失敗したときの案内
 * （監査 R583・R584・R585。合成 503・下書きなし・再試行の赤緑）。
 */
describe('下書きなしと通信失敗の言い分け（監査 R583）', () => {
  it('編集は下書きなしを通信障害から分け、版の画面で新版を作る入口を示す', () => {
    // 下書きなし専用の内訳を持ち、通信障害の1枚（kind="error"＋再読込）に畳まない。
    expect(EDIT).toContain("'no-draft'")
    // 版の画面と同じ言葉で新版作成へ導く（版の画面の「前の版から新版を作る」と合わせる）。
    expect(EDIT).toContain('前の版から新版を作る')
    // 戻り先は版の画面（編集画面の id を引き継ぐ）。
    expect(EDIT).toContain('`/common-actions/versions?id=${encodeURIComponent(id)}`')
  })

  it('編集は 503 では通信障害と再読込を示す（R583 の裏側）', () => {
    expect(EDIT).toContain('下書きを読み込めませんでした')
    expect(EDIT).toContain('onRetry={() => setReloadKey((k) => k + 1)}')
  })
})

describe('再試行の成功後に古い失敗文を残さない（監査 R584）', () => {
  it('編集は取得の開始時・成功時・保存時に取得失敗文を空に戻す', () => {
    // 保存時だけだと、再試行の成功後に古い取得失敗文が編集欄の下に残る。
    const clears = EDIT.match(/setError\(''\)/g) ?? []
    expect(clears.length).toBeGreaterThanOrEqual(3)
  })
})

describe('作成の選択肢の失敗と0件の言い分け（監査 R585）', () => {
  it('作成は入力を保ったまま選択肢だけを再取得できる入口を欄の近くに出す', () => {
    expect(NEW).toContain('選択肢をもう一度読み込む')
    // 再取得は選択肢だけを取り直し、名前・説明・処理（state）には触らない。
    expect(NEW).toContain('resourcesReloadKey')
    expect(NEW).not.toContain("setName('')")
    expect(NEW).not.toContain("setDescription('')")
    expect(NEW).not.toContain('setActions([])')
  })

  it('作成は選択肢の取得失敗と真の0件を分ける', () => {
    // 失敗時は取得失敗として覚え、真の0件（空のまま正常取得）と混ぜない。
    expect(NEW).toContain('resourcesFailed')
    expect(EDITOR).toContain('resourcesFailed')
    // 真の0件の案内（選べる◯◯がありません）は残す。
    expect(EDITOR).toContain('選べる')
  })

  it('作成は選択肢の取得失敗中は保存の入口を閉じ、理由を示す', () => {
    // 空の選択肢のまま保存へ進めない（兄弟画面 webinars/new と同じ形）。
    expect(NEW).toMatch(/disabled=\{[^}]*resourcesFailed/)
    // 理由は欄の近くの案内だけでなく、保存ボタンの側（title・状態文）にも出す。
    expect(NEW).toContain('選択肢を読み込めていないため保存できません')
  })
})
