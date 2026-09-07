import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const EDIT_PAGE = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const DESIGN_SETTINGS = readFileSync(join(HERE, 'edit', 'form-design-settings.tsx'), 'utf8')
const RESPONSES_PAGE = readFileSync(join(HERE, 'responses', 'page.tsx'), 'utf8')
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
    expect(PAGE).toContain('フォームがまだ1つも無いときの見え方です。')
    expect(PAGE).toContain('まだフォームがありません')
    expect(PAGE).toContain('最初の1つを作ると、集まった回答もここから見られます。')
    expect(PAGE).toContain('条件に合うフォームはありません')
    expect(PAGE).toContain('onRetry={() => void loadForms()}')
  })

  it('フォルダ・保存した検索・一覧表を正本と同じ順で置く', () => {
    expect(PAGE).toContain('data-design="Bar"')
    expect(PAGE).toContain('<FolderPanel')
    expect(PAGE).toContain('data-design="Saved"')
    expect(PAGE).toContain('フォーム名・質問文で検索')
    expect(PAGE).toContain('<TableHeadRow>')
    for (const label of ['フォーム', '状態', '回答の保存先', '回答数', '更新', '操作']) {
      expect(PAGE).toContain(label)
    }
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
    expect(PAGE).toContain('form.destinationSummary.friendFieldCount')
    expect(PAGE).toContain('form.destinationSummary.tagCount')
    expect(PAGE).toContain('title={listDestinationSummary}>{listDestinationSummary}</td>')
  })

  it('選択中のLINE公式アカウントだけを読み書きする', () => {
    expect(PAGE).toContain('useAccount()')
    expect(PAGE).toContain('account_id=${encodeURIComponent(selectedAccountId)}')
    expect(PAGE).toContain('LINE公式アカウントを選んでください')
    expect(API).toContain('createDraft: (accountId: string')
  })
})

describe('V6回答フォームの未実装3画面', () => {
  it('vCqUj は12種の追加口・顧客プレビュー・作成元を表示する', () => {
    expect(EDIT_PAGE).toContain('ブロックを追加（12種）')
    expect(EDIT_PAGE).toContain('お客さまに見える形')
    expect(EDIT_PAGE).toContain('実際にお客さまが見る画面です')
    expect(EDIT_PAGE).toContain('このフォームは {selectedAccount?.name')
    expect(EDIT_PAGE).not.toContain('このアカウントに LIFF を登録すると')
  })

  it('cSqvP はURL・受付条件・回答後アクションを保存できる', () => {
    const OPTIONS = readFileSync(join(HERE, '..', '..', 'components', 'forms', 'options-dialog.tsx'), 'utf8')
    expect(EDIT_PAGE).toContain("params.get('tab') === 'options'")
    expect(EDIT_PAGE).toContain('onSave={async () =>')
    for (const label of [
      '答え終わったあとの動きと、受付のきまり',
      '答えたあとに開くページ（任意）',
      'ページを使わないときに出す文',
      '1人1回だけ答えられるようにする',
      '前回の答えを最初から入れておく',
      '受付の期限を決める',
      '送信する前に確認画面を出す',
      '保存する',
    ]) expect(OPTIONS).toContain(label)
  })

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

  it('開始数・書き込み結果・日付項目の全件集計を実APIから表示する', () => {
    expect(RESPONSES_PAGE).toContain('responseResult.data.summary ?? null')
    expect(RESPONSES_PAGE).toContain('completedDestinationWrites(summary)')
    expect(RESPONSES_PAGE).toContain('nextVisitPeople(summary)')
    expect(RESPONSES_PAGE).toContain('summary.completionRate.toLocaleString')
    expect(RESPONSES_PAGE).toContain('destinationWriteText(item.destinationWrite)')
    expect(RESPONSES_PAGE).toContain('回答単位の版は未取得')
    expect(RESPONSES_PAGE).toContain('回答後アクションの結果は未取得')
  })
})

describe('V6回答フォームの重大修正(#503 R1・R2)', () => {
  it('デザイン設定を閉じたら編集中のフォームへ戻る', () => {
    expect(DESIGN_SETTINGS).toContain('formId: string')
    expect(DESIGN_SETTINGS).toContain('encodeURIComponent(formId)')
    expect(DESIGN_SETTINGS).not.toContain('id=form-1')
    expect(EDIT_PAGE).toContain('formId={id}')
  })

  it('複製で回答キーを一意にし、保存前に重複を止める', () => {
    expect(EDIT_PAGE).toContain('function uniqueCopyName')
    expect(EDIT_PAGE).toContain('uniqueCopyName(source.name, taken)')
    expect(EDIT_PAGE).toContain('回答キーが重なっています')
    expect(EDIT_PAGE).not.toContain('`${source.name}_copy`')
    expect(EDIT_PAGE).not.toContain('`${b.name}_copy`')
  })

  it('選択肢IDは他とそろえた作り方に統一する', () => {
    const BLOCK_EDITOR = readFileSync(join(HERE, '..', '..', 'components', 'forms', 'block-editor.tsx'), 'utf8')
    expect(BLOCK_EDITOR).toContain("newBlockId('c')")
    expect(BLOCK_EDITOR).not.toContain('Math.random')
  })
})
