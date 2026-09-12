import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const EDIT_PAGE = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const DESIGN_SETTINGS = readFileSync(join(HERE, 'edit', 'form-design-settings.tsx'), 'utf8')
const RESPONSES_PAGE = readFileSync(join(HERE, 'responses', 'page.tsx'), 'utf8')
const FORM_PREVIEW = readFileSync(join(HERE, '..', '..', 'components', 'forms', 'form-preview.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')
const FORM_OPERATIONS = readFileSync(join(HERE, '..', '..', 'components', 'forms', 'form-definition-operations.ts'), 'utf8')
const FORM_VALIDATION = readFileSync(join(HERE, '..', '..', 'components', 'forms', 'form-definition-validation.ts'), 'utf8')

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
    expect(PAGE).toContain('まだフォームがありません')
    expect(PAGE).toContain('最初の1つを作ると、集まった回答もここから見られます。')
    expect(PAGE).not.toContain('見え方です。')
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

  it('回答の閲覧は専用ルートへ導き、一覧に到達不能の回答表を置かない(#503 M2)', () => {
    expect(PAGE).toContain('集まった回答を見る')
    expect(PAGE).toContain('/form-submissions/responses?id=')
    expect(PAGE).not.toContain('loadSubmissions')
    expect(PAGE).not.toContain('selectedForm')
    expect(PAGE).not.toContain('AnswerValue')
    expect(PAGE).not.toContain('submissions?page=')
  })

  it('「情報欄に保存している」の絞り込みは文言でなく数で見る(#503 M1)', () => {
    expect(PAGE).toContain('hasStoredDestination(form.layout, form.onSubmitTagId)')
    expect(PAGE).not.toContain(".label === '—'")
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

describe('#676 一覧の並び・件数・回答導線（N-172/N-173/N-180/N-181）', () => {
  it('並び順と表示件数を実際の一覧へ効かせ、URLへ残す', () => {
    // 何で並べるか・何件出すかは試験で固定しない。
    // 「選んだ値が一覧とURLへ届く」ことだけを見る。
    expect(PAGE).toContain('aria-label="並び順"')
    expect(PAGE).toContain('FORM_PAGE_SIZES')
    expect(PAGE).toContain('router.replace(')
    expect(PAGE).not.toContain('onChange={() => undefined}')
    expect(PAGE).toContain('visibleForms.map((form)')
  })

  it('回答の導線はその行のフォームを指し、先頭固定の帯を置かない', () => {
    expect(PAGE).not.toContain('forms[0]')
    expect(PAGE).toContain('responses?id=${encodeURIComponent(form.id)}')
    expect(PAGE).toContain('の集まった回答を見る`}')
  })

  it('更新列は作成日ではなく更新日時を出し、無い状態を区別する', () => {
    expect(PAGE).toContain('displayUpdatedAt(form.updatedAt)')
    expect(PAGE).toContain('更新日時を取得できません')
    expect(PAGE).not.toContain('new Date(form.createdAt).toLocaleDateString')
  })

  it('staffへはフォルダ追加を出さず、owner/adminへは止めて置く（N-175 は #688）', () => {
    // 役割の判定は自分で書き直さず、1か所に寄せてあるものを読む。
    expect(PAGE).toContain("from '@/components/automations/use-can-manage'")
    // staff（false）と読み取り前（null）は要素ごと出さない。
    expect(PAGE).toContain('addFolderDisabled={canAddFolder === true}')
    expect(PAGE).toContain('addFolderTitle=')
    expect(PAGE).not.toContain('FolderAddDialog')
    expect(PAGE).not.toContain('onAddFolder')
    // 画面の中で数え方を作らない。フォルダの件数はAPIが返す値だけを出す。
    expect(PAGE).not.toContain('folderCounts')
    expect(PAGE).not.toContain("form.folderId || 'unfiled'")
  })

  it('実ブラウザ検査は通信が止まるのを待たず、画面が出す印で待つ', () => {
    const BROWSER = readFileSync(join(HERE, 'form-submissions-browser-behavior.mjs'), 'utf8')
    // 通信が止まる瞬間は管理画面では来ないことがある。待つ条件にしない。
    expect(BROWSER).not.toMatch(/waitUntil:\s*'networkidle'/)
    expect(BROWSER).toContain("waitUntil: 'domcontentloaded'")
    expect(BROWSER).toContain('data-design-node="EMBIK"')
    expect(BROWSER).toContain('data-list-state="loading"')
    // 実在しない `folderId` を混ぜた模擬データへ戻らないようにする。
    expect(BROWSER).not.toContain('folderId:')
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

  /*
   * #725 で背景画像の操作面を消したため、旧・表明の '背景画像' を外した。
   * 旧・表明が捕まえていた壊し方と、いまどこで捕まえるかの対応:
   *
   *   (a) デザイン設定から色・書体・角丸の操作面が消える
   *       → 下の label ループがそのまま見張る（'背景画像' 以外は据え置き）
   *   (b) 背景画像の値そのものが画面から失われる
   *       → 消したのは操作面だけで、値は `form-preview.tsx` が描き続ける。
   *         `theme.backgroundImageUrl` を preview が読むことを下で見張る
   *   (c) OGP が保存経路から外れる
   *       → EDIT_PAGE の3行の表明を据え置き、さらに **この窓から編集できる**
   *         ことを実マウントの試験（form-design-settings.dead-ui.test.tsx）で見張る
   */
  it('ava2n は5色・書体・角丸を持ち、SNS表示を保存する', () => {
    expect(EDIT_PAGE).toContain("params.get('tab') === 'design'")
    expect(EDIT_PAGE).toContain('<FormDesignSettings')
    expect(EDIT_PAGE).not.toContain('title="準備中です"')
    for (const label of ['メイン', 'サブ', 'アクセント', 'エラー', '文字', '文字の書体', '角の丸み']) {
      expect(DESIGN_SETTINGS).toContain(label)
    }
    // (b) 操作面は消したが、背景画像の値は捨てていない。
    expect(FORM_PREVIEW).toContain('theme.backgroundImageUrl')
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
    expect(RESPONSES_PAGE).toContain('submissions?page=${currentPage}&limit=${EXPORT_PAGE_LIMIT}&account_id=')
    expect(RESPONSES_PAGE).toContain('while (all.length < expected')
    expect(RESPONSES_PAGE).toContain('<Pagination')
    expect(RESPONSES_PAGE).toContain('<TableHeadRow>')
    expect(RESPONSES_PAGE).toContain('<Th')
  })

  it('CSV書き出しは上限を超えたら止めて件数を言い、進み具合を出す(#503 M7)', () => {
    expect(RESPONSES_PAGE).toContain('MAX_EXPORT_ROWS')
    expect(RESPONSES_PAGE).toContain('export_too_many')
    expect(RESPONSES_PAGE).toContain('一度に書き出せる上限')
    expect(RESPONSES_PAGE).toContain('件を取得中')
  })

  it('回答一覧は速いページ送りでも最新の要求だけを描く(#503 M8)', () => {
    expect(RESPONSES_PAGE).toContain('loadRequest.current')
    expect(RESPONSES_PAGE).toContain('request !== loadRequest.current')
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
    expect(FORM_OPERATIONS).toContain('function uniqueFormCopyName')
    expect(EDIT_PAGE).toContain('uniqueCopyName(source.name, taken)')
    expect(FORM_VALIDATION).toContain('回答データの見出し「${block.name}」が重複しています')
    expect(EDIT_PAGE).not.toContain('`${source.name}_copy`')
    expect(EDIT_PAGE).not.toContain('`${b.name}_copy`')
  })

  it('選択肢IDは他とそろえた作り方に統一する', () => {
    const BLOCK_EDITOR = readFileSync(join(HERE, '..', '..', 'components', 'forms', 'block-editor.tsx'), 'utf8')
    expect(BLOCK_EDITOR).toContain("newBlockId('c')")
    expect(BLOCK_EDITOR).not.toContain('Math.random')
  })
})

describe('V6回答フォームの中項目(#503 M3・M9)', () => {
  it('編集画面の参照一覧は選んでいる公式アカウントに絞る', () => {
    expect(EDIT_PAGE).toContain('/api/tags?lineAccountId=${encodeURIComponent(selectedAccountId)}')
    expect(EDIT_PAGE).toContain('api.scenarios.list(accountFilter)')
    expect(EDIT_PAGE).toContain('api.reminders.list(accountFilter)')
    expect(EDIT_PAGE).toContain('api.templates.list(undefined, selectedAccountId ?? undefined)')
    expect(EDIT_PAGE).not.toContain('api.tags.list()')
  })

  it('保存前に選択肢・URL・期限の形を見て、未保存のままの移動は確認する', () => {
    expect(EDIT_PAGE).toContain('validateLayoutForSave(layout)')
    expect(EDIT_PAGE).toContain('beforeunload')
    expect(EDIT_PAGE).toContain('保存していない変更があります')
    expect(EDIT_PAGE).toContain('savedSnapshot.current = currentSnapshot')
  })
})

describe('#578 ページ名の変更（#503 L3）', () => {
  it('空のページ名は作らせず、無い頁は触らない', () => {
    expect(EDIT_PAGE).toContain("from '@/components/forms/section-name'")
    expect(EDIT_PAGE).toContain('if (!current) return')
    expect(EDIT_PAGE).toContain('normalizeSectionName(next)')
    expect(EDIT_PAGE).toContain('空のページ名は作らせない')
  })
})
