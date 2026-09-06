import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const EDIT_PAGE = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const DESIGN_SETTINGS = readFileSync(join(HERE, 'edit', 'form-design-settings.tsx'), 'utf8')
const RESPONSES_PAGE = readFileSync(join(HERE, '[id]', 'responses', 'page.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('V6回答フォーム一覧', () => {
  it('EMBIKどおり画面名は共通トップバーだけに置く', () => {
    expect(PAGE).toContain('data-design-node="EMBIK"')
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('友だちに答えてもらうフォームを作ります。')
  })

  it('初回空・検索0件・読込中・失敗を言い分ける', () => {
    expect(PAGE).toContain("kind=\"loading\"")
    expect(PAGE).toContain("kind=\"error\"")
    expect(PAGE).toContain('まだ回答フォームがありません')
    expect(PAGE).toContain('条件に合うフォームはありません')
    expect(PAGE).toContain('onRetry={() => void loadForms()}')
  })

  it('フォーム数と公開中は未取得を0件にせずダッシュで表示する', () => {
    expect(PAGE).toContain('const formCountsAvailable = !accountLoading && Boolean(selectedAccountId) && !loading && !loadError')
    expect(PAGE).toContain('value={formCountsAvailable ? forms.length : null}')
    expect(PAGE).toContain('value={formCountsAvailable ? forms.filter((form) => form.isActive).length : null}')
  })

  it('フォームを公開せず下書きで作って編集画面へ進む', () => {
    expect(API).toContain('createDraft:')
    expect(PAGE).toContain('api.forms.createDraft(selectedAccountId)')
    expect(PAGE).toContain('フォームを作る')
    expect(PAGE).toContain('&tab=basic')
    expect(PAGE).not.toContain('準備中')
  })

  it('回答はAPI側でページ分けし、共通の表示件数とページ送りを使う', () => {
    expect(PAGE).toContain('submissions?page=${requestedPage}&limit=${requestedLimit}')
    expect(PAGE).toContain('<Pagination')
    expect(PAGE).toContain('<Select')
    expect(PAGE).not.toContain('submissions.slice(')
  })

  it('一覧で回答の保存先をフォーム定義の実値から表示する', () => {
    expect(PAGE).toContain('summarizeFormDestinations(form.layout, form.onSubmitTagId)')
    expect(PAGE).toContain('回答の保存先')
    expect(PAGE).toContain('{destinationSummary.label}')
  })

  it('選択中のLINE公式アカウントだけを読み書きする', () => {
    expect(PAGE).toContain('useAccount()')
    expect(PAGE).toContain('account_id=${encodeURIComponent(selectedAccountId)}')
    expect(PAGE).toContain('LINE公式アカウントを選んでください')
    expect(API).toContain('createDraft: (accountId: string')
  })
})

describe('V6回答フォームの未実装3画面', () => {
  it('ava2n は押せるデザイン設定で、5色・書体・角丸・背景とSNS表示を保存する', () => {
    expect(EDIT_PAGE).toContain("params.get('tab') === 'design'")
    expect(EDIT_PAGE).toContain('<FormDesignSettings')
    expect(EDIT_PAGE).not.toContain('title="準備中です"')
    for (const label of ['メイン', 'サブ', 'アクセント', 'エラー', '文字', '文字の書体', '角の丸み', '背景画像']) {
      expect(DESIGN_SETTINGS).toContain(label)
    }
    expect(EDIT_PAGE).toContain('ogTitle: ogTitle.trim() || null')
    expect(EDIT_PAGE).toContain('ogDescription: ogDescription.trim() || null')
    expect(EDIT_PAGE).toContain('ogImageUrl: ogImageUrl.trim() || null')
  })

  it('v9tYhl は専用ルートで通常・読込・空・失敗を言い分ける', () => {
    expect(RESPONSES_PAGE).toContain('data-design-node="v9tYhl"')
    expect(RESPONSES_PAGE).toContain('kind="loading"')
    expect(RESPONSES_PAGE).toContain('kind="error"')
    expect(RESPONSES_PAGE).toContain('まだ回答がありません')
    expect(RESPONSES_PAGE).toContain('条件に合う回答はありません')
    expect(RESPONSES_PAGE).toContain('onRetry={() => void load(page, pageSize)}')
  })

  it('回答はアカウントを限定してAPI側ページングし、全ページをCSVへ集める', () => {
    expect(RESPONSES_PAGE).toContain('submissions?page=${nextPage}&limit=${nextLimit}&${account}')
    expect(RESPONSES_PAGE).toContain('submissions?page=${currentPage}&limit=50&account_id=')
    expect(RESPONSES_PAGE).toContain('while (all.length < expected')
    expect(RESPONSES_PAGE).toContain('<Pagination')
    expect(RESPONSES_PAGE).toContain('<TableHeadRow>')
    expect(RESPONSES_PAGE).toContain('<Th')
  })

  it('取得口が無い指標を0件にせずダッシュと理由で出す', () => {
    expect(RESPONSES_PAGE).toContain('value="—" note="開いた実人数の集計口がありません"')
    expect(RESPONSES_PAGE).toContain('回答単位の書き込み結果は未取得です')
    expect(RESPONSES_PAGE).toContain('回答単位の版は未取得')
    expect(RESPONSES_PAGE).toContain('回答単位の結果は未取得')
  })
})
