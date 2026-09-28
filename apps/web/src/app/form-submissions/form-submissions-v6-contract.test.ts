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
// 定義の検査は shared に置く。画面と保存APIが同じ判定を使うため。
const SHARED_FORM_LAYOUT = readFileSync(join(HERE, '..', '..', '..', '..', '..', 'packages', 'shared', 'src', 'form-layout.ts'), 'utf8')

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
    expect(PAGE).toContain('＋ フォームを作る')
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

  /*
   * R25 で接続したため、未接続の札の表明は外した（#688 の migration 372 待ちは
   * migration 395 で入り、箱の作成・名前変更・削除・移動の口もつながった）。
   * 残すのは意図：staff へは箱の操作を見せず、件数は画面で数えない。
   */
  it('箱の作成・名前変更・削除・移動は選んだアカウントでつながる（R25）', () => {
    // 未接続の札は出さない。
    expect(PAGE).not.toContain('addFolderDisabled')
    expect(PAGE).not.toContain('保存先は未接続')
    // 役割の判定は役割だけを見るものに寄せる（箱の口は requireRole）。
    expect(PAGE).toContain("from '@/lib/staff-capability'")
    expect(PAGE).toContain('isOwnerOrAdmin()')
    expect(PAGE).not.toContain('use-can-manage')
    // 共通の箱部品で作る・直す・消す・並べ替える。移すはフォームの更新口へ。
    expect(PAGE).toContain("from '@/components/shared/folder-add-dialog'")
    expect(PAGE).toContain('<FolderAddDialog')
    expect(PAGE).toContain('kind="form"')
    expect(PAGE).toContain('onAddFolder=')
    expect(PAGE).toContain('api.folders.list(')
    expect(PAGE).toContain('api.folders.swapOrder(')
    expect(PAGE).toContain('api.folders.delete(')
    expect(PAGE).toContain('folderId: nextFolderId')
    // 画面の中で数え方を作らない。箱ごとの件数は数えていないと出す。
    expect(PAGE).toContain('folder.itemCount ?? null')
    expect(PAGE).not.toContain('folderCounts')
    expect(PAGE).not.toContain("form.folderId || 'unfiled'")
  })

  it('行の「編集」は質問の編集へ行き、名前変更は「…」の中へ入る（R27）', () => {
    // 主ボタンはフォームの編集（質問）への行き先。名前変更の窓は開かない。
    expect(PAGE).toContain('<RowActions')
    expect(PAGE).toContain('edit={{ href: `/form-submissions/edit?id=${encodeURIComponent(form.id)}&tab=basic` }}')
    expect(PAGE).toContain("label: '名前を変更'")
    expect(PAGE).toContain("label: 'フォルダへ移す'")
    expect(PAGE).not.toContain('openRename(form)}>編集<')
    // 名前の保存は編集保存と同じ口を通るので、確認した編集の版を添える。
    expect(PAGE).toContain('renameRevision')
    expect(PAGE).toContain('expectedContentRevision: revision')
  })

  it('実ブラウザ検査は通信が止まるのを待たず、画面が出す印で待つ', () => {
    const BROWSER = readFileSync(join(HERE, 'form-submissions-browser-behavior.mjs'), 'utf8')
    // 通信が止まる瞬間は管理画面では来ないことがある。待つ条件にしない。
    expect(BROWSER).not.toMatch(/waitUntil:\s*'networkidle'/)
    expect(BROWSER).toContain("waitUntil: 'domcontentloaded'")
    expect(BROWSER).toContain('data-design-node="EMBIK"')
    expect(BROWSER).toContain('data-list-state="loading"')
    // R25: 箱の絞りは API 側が済ませる。模擬も本物と同じく `folder_id` で絞る。
    expect(BROWSER).toContain('folder_id')
    expect(BROWSER).toContain('folderId')
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

  it('オプション設定の窓と動作の欄はスマホ幅に収まる（R26）', () => {
    const OPTIONS = readFileSync(join(HERE, '..', '..', 'components', 'forms', 'options-dialog.tsx'), 'utf8')
    const ACTIONS = readFileSync(join(HERE, '..', '..', 'components', 'forms', 'action-editor.tsx'), 'utf8')
    const PANEL = readFileSync(join(HERE, '..', '..', 'components', 'forms', 'options-dialog.module.css'), 'utf8')
    // 固定の高さ・幅・最小幅は置かない。窓は画面の高さに収め、中身だけ流す。
    expect(OPTIONS).not.toContain('height: 900')
    expect(OPTIONS).not.toContain('minWidth: 680')
    expect(OPTIONS).not.toMatch(/max-h-\[|max-w-\[|my-\[/)
    expect(PANEL).toContain('calc(100dvh - 2rem)')
    expect(PANEL).toContain('max-width: 880px')
    // 動作の欄は狭い幅で縦に並べ、欄の固定の最小幅をなくす。
    expect(OPTIONS).toContain('flex-col gap-2 sm:flex-row')
    expect(ACTIONS).not.toContain('min-w-[16rem] flex-1')
    expect(ACTIONS).toContain('min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[16rem]')
    expect(ACTIONS).toContain('min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[10rem]')
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
  })

  it('後処理の未完を一覧・詳細へ出し、未完分だけを再実行する口を持つ(N-168)', () => {
    // 「結果は未取得」のまま黙らせない。API が返す工程記録を表示に使う。
    expect(RESPONSES_PAGE).not.toContain('回答後アクションの結果は未取得')
    expect(RESPONSES_PAGE).toContain('postActionsText(item.postActions)')
    expect(RESPONSES_PAGE).toContain('postActionsNeedRetry(item.postActions)')
    expect(RESPONSES_PAGE).toContain('後処理に未完があります')
    // 再実行はその回答の未完分だけを頼む専用の口。
    expect(RESPONSES_PAGE).toContain('retry-effects?account_id=')
    expect(RESPONSES_PAGE).toContain('未完の工程だけ再実行する')
    // 再実行の応答で一覧と詳細を同じ状態へ更新する。
    expect(RESPONSES_PAGE).toContain('row.id === updated.id ? updated : row')
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
    // 検査の本体は shared の validateFormDefinition（保存APIも同じものを使う）
    expect(FORM_VALIDATION).toContain('validateFormDefinition')
    expect(SHARED_FORM_LAYOUT).toContain('回答データの見出し「${block.name}」が重複しています')
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
    // 未保存の離脱確認は共通フックに一本化（DETAIL-04系の画面ごとの差を無くす）。
    expect(EDIT_PAGE).toContain('useUnsavedGuard')
    expect(EDIT_PAGE).toContain('保存していない変更があります')
    expect(EDIT_PAGE).toContain('savedSnapshot.current = currentSnapshot')
  })
})

describe('P 一覧の数・公開前の試し・読みにくい色', () => {
  it('一覧の行に今月の件数と完了率を出し、「？」は見出しに1つだけ置く', () => {
    expect(PAGE).toContain('今月 ${form.monthlySubmitCount')
    expect(PAGE).toContain('完了率 ${form.monthlyCompletionRate')
    expect(PAGE).toContain('今月 —')
    expect(PAGE).toContain('完了率 —')
    expect(PAGE).toContain('今月の完了率の説明')
    expect(PAGE).toContain('試しの回答は入れていません')
    // 「？」の説明は見出しに1つだけ。行に並べない。
    expect((PAGE.match(/今月の完了率の説明/g) ?? []).length).toBe(1)
    // 死んでいた今週表示は出さない。数はサーバーが数える。
    expect(PAGE).not.toContain('今週')
    expect(PAGE).not.toContain('weeklySubmitCount')
  })

  it('編集画面から公開前の試しを始められる', () => {
    expect(EDIT_PAGE).toContain('テスト回答を始める')
    expect(EDIT_PAGE).toContain('api.forms.issueTestToken(id, selectedAccountId)')
    expect(EDIT_PAGE).toContain('試しURL')
    expect(EDIT_PAGE).toContain('試しの回答は集計に入らず')
    expect(API).toContain('issueTestToken:')
    expect(API).toContain('/test-token?account_id=')
  })

  it('読みにくい色は画面と保存の両方で止める', () => {
    expect(DESIGN_SETTINGS).toContain('formThemeContrastError')
    expect(DESIGN_SETTINGS).toContain('文字と背景の色の決まりの説明')
    expect(DESIGN_SETTINGS).toContain('role="alert"')
    expect(EDIT_PAGE).toContain('formThemeContrastError(normalizeFormTheme(layout.options?.theme))')
    expect(SHARED_FORM_LAYOUT).toContain('formThemeContrastError')
    expect(SHARED_FORM_LAYOUT).toContain('FORM_THEME_MIN_CONTRAST')
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
