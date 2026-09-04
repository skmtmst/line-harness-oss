import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('友だち属性 V4 contract', () => {
  it('タグ作成で本人・紹介者マイルと倍率を同時に設定できる', () => {
    const editor = read('components/friend-fields/tag-editor-v4.tsx')
    const page = read('components/friend-fields/new-tag-page-v4.tsx')
    expect(editor).toContain('本人へのマイル付与')
    expect(editor).toContain('紹介者へのマイル付与')
    expect(editor).toContain('今後のマイル倍率')
    expect(editor).toContain('タグを外して付け直したときの扱い')
    expect(page).toContain('applyToExisting: false')
  })

  it('タグ編集の遡及付与は初期OFFで専用確認を通す', () => {
    const editor = read('components/friend-fields/tag-editor-v4.tsx')
    const page = read('components/friend-fields/edit-tag-page-v4.tsx')
    expect(editor).toContain("useState(initialValues?.applyToExisting ?? initialApplyToExisting)")
    expect(editor).toContain('すでに付いている人への反映')
    expect(editor).toContain('さかのぼってマイルを積みますか？')
    expect(page).toContain('applyToExisting: applyRetroactive && values.applyToExisting')
  })

  it('タグ編集と対応マーク保管はV6の結果を正しく案内する', () => {
    const editor = read('components/friend-fields/tag-editor-v4.tsx')
    const markList = read('components/friend-fields/mark-list.tsx')
    expect(editor).toContain("mode === 'edit' ? 'この変更で起きること' : 'この設定で起きること'")
    expect(editor).toContain('取り消せない操作です')
    expect(markList).toContain('友だちは「${defaultMark?.name')
    expect(markList).toContain('変更履歴は残ります')
    expect(markList).not.toContain('対応マークが未設定へ戻ります')
  })

  it('タグ作成・編集は画面名をトップバーだけに置き、V6の操作を下部へまとめる', () => {
    const editor = read('components/friend-fields/tag-editor-v4.tsx')
    expect(editor).toContain("usePageTitle(mode === 'create' ? 'タグを作る' : 'タグを編集')")
    expect(editor).toContain('<StickyBar')
    expect(editor).not.toContain('text-[32px] font-bold tracking-tight')
    expect(editor).not.toContain('友だちを分類するタグを作ります。タグが付いた瞬間の連動')
    expect(editor).toContain('番目のアクションを複製')
    expect(editor).toContain("action.type === 'タグ' || action.type === 'マイル'")
    // マイル設定だけを根拠に、存在しない連動アクションを作って表示しない。
    expect(editor).not.toContain("id: 'sample-1'")
  })

  it('タグの複製はリンクだけで終わらず、既存データを作成画面へ引き継ぐ', () => {
    const page = read('components/friend-fields/new-tag-page-v4.tsx')
    expect(page).toContain("const copyId = params.get('copy')")
    expect(page).toContain('api.tags.list({ withCounts: true })')
    expect(page).toContain('name: `${copySource.name} のコピー`')
    expect(page).toContain('rewardMiles: copySource.mileageReward ?? 0')
    expect(page).toContain('actions: []')
  })

  it('一覧は20・30・40・50件で切り替え、ページを無限に横並びにしない', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    expect(source).toMatch(/\[20,\s*30,\s*40,\s*50\]/)
    // 2026-08-26: ページ送りは共通部品 `Pagination`（設計 `Blot6`）へ寄せた。
    // 自前で組むと、高さ38・角丸・現在ページの緑がほかの一覧とずれる。
    expect(source).toContain('<Pagination')
    expect(source).not.toContain("'前へ'")
    expect(source).toContain('CSVで一括登録')
    // 2026-08-26: 「並び替え」ボタンは設計に無い。つまみを常に出して、
    // いつでも並び替えられるようにした（docs/v6-common-rules.md §1 の 4-1 基準）。
    expect(source).not.toContain('並び替えを終了')
    expect(source).toContain('ドラッグして並び替え')
    expect(source).not.toContain('min-w-[1180px]')
  })

  it('情報欄と対応マークもPC画面で横スクロールを要求しない', () => {
    const sources = [
      read('components/friend-fields/field-list.tsx'),
      read('components/friend-fields/mark-list.tsx'),
    ]
    for (const source of sources) {
      expect(source).toContain('table-fixed')
      expect(source).not.toMatch(/min-w-\[/)
      expect(source).not.toContain('overflow-x-auto')
    }
  })

  it('友だち情報欄はV6の一覧・作成・移行前の確認を縦に通す', () => {
    const list = read('components/friend-fields/field-list.tsx')
    const create = read('app/tags/fields/new/page.tsx')
    const migrate = read('app/tags/fields/migrate/page.tsx')
    expect(list).toContain('data-design-node="HBTk0"')
    expect(create).toContain('data-design-node="A1ZYeP"')
    expect(migrate).toContain('data-design-node="KoT6c"')
    expect(list).toContain('/tags/fields/migrate?id=')
    expect(migrate).toContain('api.friendFields.migrationPreview(')
    expect(migrate).toContain('事前確認する')
    expect(migrate).not.toContain('dry-run')
    expect(migrate).toContain('友だちの値や既存の項目は変更しません')
    expect(migrate).not.toContain('migrationExecute')
    // 回答フォームはまだアカウント所属を持たない。全体件数を0件と偽らない。
    // **見るのは「口が無いときに数を作らないか」。言い方の字面は固定しない。**
    // 「未取得」の一語だけでは、待てば出るのか・壊れているのかが分からないので、
    // 共通部品の文へ広げた（`field-list-kpi-reason-contract.test.ts` が中身を見る）。
    expect(list).toContain('summary?.formLinks === null')
    expect(list).toContain("notConnectedText('回答フォームの登録先')")
    // 画面名は共通トップバーだけに置く。本文の大見出しへ戻さない。
    expect(create).not.toContain("import Header from '@/components/layout/header'")
    expect(migrate).not.toContain("import Header from '@/components/layout/header'")
  })

  it('友だち情報欄の読込失敗を空状態や作成導線と混ぜない', () => {
    const source = read('components/friend-fields/field-list.tsx')
    const empty = source.indexOf('まだ友だち情報欄がありません')
    expect(empty).toBeGreaterThan(-1)
    expect(source.slice(0, empty).lastIndexOf("status === 'error'")).toBeGreaterThan(-1)
    expect(source).toContain("status === 'ready' ? <Button href=\"/tags/fields/new\"")
    expect(source).toContain('status === \'ready\' && error')
    expect(source).toContain('友だち情報欄を再読み込み</Button>')
    expect(source).toContain("setError(forbidden ? '' : '再読み込みしても直らない場合はエラー報告へ。')")
    expect(source).toContain('setItems([])')
  })

  it('使用人数を取得できない項目を0人として削除しない', () => {
    const source = read('components/friend-fields/field-list.tsx')
    expect(source).toContain('function knownUsageCount(field: FriendField)')
    expect(source).toContain('function fieldDeletionBlockedReason(field: FriendField)')
    expect(source).toContain('使用人数を確認できないため削除できません。再読み込みしてください。')
    expect(source).toContain('disabled={fieldDeletionBlockedReason(field) !== null}')
    expect(source).toContain('const blockedReason = fieldDeletionBlockedReason(field)')
    expect(source).not.toContain('disabled={(field.usageCount ?? 0) > 0}')
  })

  it('友だち属性ではブラウザ標準confirmを使わない', () => {
    const sources = [
      read('components/friend-fields/tags-page-v4.tsx'),
      read('components/friend-fields/tag-editor-v4.tsx'),
      read('components/friend-fields/edit-tag-page-v4.tsx'),
      read('components/friend-fields/field-list.tsx'),
      read('components/friend-fields/mark-list.tsx'),
      read('components/friend-fields/saved-search-list.tsx'),
    ]
    for (const source of sources) {
      expect(source).not.toMatch(/\bconfirm\s*\(/)
    }
  })

  it('Pen.devで指定された8状態を検証用ルートから再現できる', () => {
    const source = read('app/visual-qa/friend-attributes/page.tsx')
    for (const state of ['list', 'create', 'linked', 'drawer', 'edit', 'retroactive', 'delete', 'folder']) {
      expect(source).toContain(`'${state}'`)
    }
    expect(source).toContain('LINKED_ACTIONS')
    expect(source).toContain('initialRetroactiveOpen')
    expect(source).toContain('<DeleteDialog')
    expect(source).toContain('<FolderEditor')
  })

  it('空・読込・エラー・権限不足を言い分ける', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // 設計 ★V6 4-2-C `yKEdO`。共通部品に寄せる（自前で組むと画面ごとにずれる）。
    expect(source).toContain("import ListState from '@/components/shared/list-state'")
    for (const kind of ['loading', 'forbidden', 'error', 'empty']) {
      expect(source, `${kind} を出していない`).toContain(`kind="${kind}"`)
    }
    // 403 は「壊れた」ではなく「見せてよい人ではない」。同じ扱いにしない。
    expect(source).toContain("reason.status === 403 ? 'forbidden' : 'error'")
    // 読み込めなかったときに「ありません」と言い切らない（PR #216 と同じ壊れ方）。
    const empty = source.indexOf('まだタグがありません')
    expect(empty).toBeGreaterThan(-1)
    const before = source.slice(0, empty)
    expect(before.lastIndexOf("status === 'error'")).toBeGreaterThan(-1)
    // 中身を出せていないあいだは数を出さない。0件と出すと消えたように見える。
    expect(source).toContain("const ready = status === 'ready'")
    expect(source).toContain('countsKnown={ready}')
    // 権限が無いときは作る操作を出さない。
    expect(source).toContain("status === 'forbidden' ? null : (")
  })

  it('取れていない値を「0件」や「手動」で埋めない', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // 自動付与のもと。サーバーは断定できないものを省く（`getTagsWithUsage`）。
    // ここで「手動」と埋めると、断定できなかったものを断定したことになる。
    expect(source).toContain("tag.assignSource ? SOURCE_LABELS[tag.assignSource] : '—'")
    // 使用先。`withCounts=1` で読んでいるので、無いのは0件＝「未使用」。
    expect(source).toContain("api.tags.list({ withCounts: true })")
    expect(source).toContain("if (!tag.usedIn) return 'なし'")
    /*
      「未使用」は **友だち0人かつ全参照0件**（kenta 確定 2026-08-26）。
      参照だけで判断すると、200人に付いているタグまで整理候補に入る。
      使用先の列で「未使用」と書かないのも同じ理由（言葉に2つの意味を持たせない）。
    */
    expect(source).toContain('return !tag.usedIn && (tag.friendCount ?? 0) === 0')
    expect(source).toContain('const unused = isUnused(tag)')
    // 連動の「他N」。0件のときサーバーは省くので「他0」は出ない。
    expect(source).toContain('if (tag.otherActionCount) chips.push(')
    // 整理候補は「未使用＋重複名」。未取得は `—`（value: null）、
    // 取得できて0件は `0件`。単位の出し分けで見分ける。
    expect(source).toContain("{ title: '整理候補', value: cleanupCount")
    // 削除の確認に固定値を書かない。
    expect(source).not.toMatch(/参照<\/dt><dd[^>]*>3件/)
    // 積んだマイルは口を待たず、「そのまま残る」で固定（2026-08-26）。
    // `—` に戻すと「まだ数えている」ように見え、いつまでも埋まらない欄になる。
    expect(source).toContain("{ name: '積んだマイル', value: 'そのまま残る', result: '取り消されません' }")
  })

  it('整理候補と未使用は、サーバーの cleanupReasons だけを数える', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    /*
      同じ画面でKPI・絞り込み・使用先が別々に数えると、数が食い違った
      理由を誰も追えなくなる。数え方は1つに寄せる。
    */
    // **読んでいない**ことを見る。コメントで名前に触れるのは構わない
    // （文字列そのものを禁じると、理由を書いた注釈で落ちる）。
    expect(source).not.toMatch(/\$\{stats\.tags\.unused\}/)
    expect(source).not.toMatch(/value:\s*stats\.tags\.unused/)
    expect(source).toContain("tag.cleanupReasons.includes('unused')")
    expect(source).toContain("cleanupItems.filter((tag) => tag.cleanupReasons?.includes('unused')).length")
    // 整理候補は「理由が1つでもある」タグ。両方に当たっても1つと数える。
    expect(source).toContain('(tag.cleanupReasons?.length ?? 0) > 0')
    // **1件でも欠けたら未取得。** 揃わないまま数えると少なく出る。
    expect(source).toContain('items.every((tag) => Array.isArray(tag.cleanupReasons))')
    // 読み込み中の空配列は未取得、取得済みの空配列は0件。
    expect(source).toContain('return ready && items.every((tag) => Array.isArray(tag.cleanupReasons))')
    // #384で共通Tag型へ入ったため、画面だけの仮型へ戻さない。
    expect(source).not.toContain('TagWithCleanup')
    // 未取得は `—`、取得できて0件は `0件`。
    expect(source).toContain("`未使用 ${unusedCount === null ? '—' : `${unusedCount}件`}`")
    expect(source).toContain("unit: cleanupCount === null ? '' : '件'")
  })

  it('「よく使う」は設計の5つで、どれも絞り込みに効く', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    for (const label of ['未使用のタグ', '今月増えたタグ', '自動付与あり', '連動あり', '★のみ表示']) {
      expect(source, `よく使うに「${label}」が無い`).toContain(label)
    }
    // 2026-08-26: 「今月増えた」は札だけあって、絞り込みに枝が無く
    // **押しても何も起きなかった**。5つとも枝があることを見る。
    for (const key of ['unused', 'recent', 'auto', 'linked', 'starred']) {
      expect(source, `よく使う「${key}」に絞り込みの枝が無い`).toContain(`key === '${key}'`)
    }
  })

  it('CSV一括登録は選択・確認・完了・一部失敗を同じ操作で通す', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    const dialog = read('components/friend-fields/tag-csv-import-dialog.tsx')
    expect(source).toContain('<TagCsvImportDialog')
    expect(source).toContain('CSVで一括登録')
    expect(source).not.toContain('CSVで出力')
    expect(dialog).toContain('api.tags.importPreview(rows)')
    expect(dialog).toContain('api.tags.importCsv(rows)')
    for (const nodeId of ['H374MR', 'sfTEW', 'op1rh', 'QzRsJ']) {
      expect(dialog).toContain(`'${nodeId}'`)
    }
    expect(dialog).toContain('入らなかった')
    expect(dialog).toContain('failedTagRowsCsv(result.rows)')
  })

  it('使用中のタグを、画面が削除させない', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // 削除する前に影響を数える口を叩く（PR #381）。
    expect(source).toContain('api.tags.deleteImpact(tag.id)')
    /*
      **DELETE 側にはまだ強制停止が入っていない。** 止めるのは画面の役目。
      読込中・失敗・使用中の3つとも押せなくする。
      失敗を「参照0件」と読み違えて消させないため、失敗も止める側に入れる。
    */
    expect(source).toContain("const blocked = impactStatus !== 'ready' || impact?.canDelete === false")
    expect(source).toContain('if (blocked || text !== tag.name || saving) return')
    expect(source).toContain('disabled={blocked || saving || text !== tag.name}')
    // 確認欄も止める。名前を打てば消せる、と思わせない。
    expect(source).toContain('disabled={blocked}')
    // 止まっている理由を必ず出す。押せないだけだと理由が分からない。
    expect(source).toContain('影響を確認しています')
    expect(source).toContain('影響を確認できませんでした')
    expect(source).toContain('使用中のため削除できません')
    // 消せるタグに赤い警告を出さない。以前は三項演算子の else で
    // 「アフィリエイトのオファーで使用中」と誤表示していた。
    expect(source).toContain("impactStatus === 'ready' && impact && !impact.canDelete && (")
    expect(source).not.toContain('アフィリエイトのオファーで使用中のタグは削除できません')
  })

  it('参照先は0件のものを出さず、取れないときは「0」と書かない', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // 18種類すべてに呼び名がある。取りこぼすと、参照があるのに出ない。
    const keys = [
      'broadcasts', 'forms', 'scenarios', 'autoReplies', 'savedSearches',
      'automations', 'commonActions', 'richMenus', 'templates', 'webinars',
      'reminders', 'entryRoutes', 'trackedLinks', 'bookingMenus',
      'affiliateOffers', 'events', 'analyticsFunnels', 'friendAddSettings',
    ]
    for (const key of keys) {
      expect(source, `参照先「${key}」に呼び名が無い`).toContain(`'${key}',`)
    }
    // 0件は出さない。
    expect(source).toContain('labels.filter(([key]) => refs[key] > 0)')
    // 取れていないときは `—`。0件（「なし」）と書き分ける。
    expect(source).toContain("refs ? refSummary(refs, MANUAL_REFS) : '—'")
    expect(source).toContain("refs ? refSummary(refs, AUTO_REFS) : '—'")
  })

  it('タグの作成・編集・一覧ルートはV4を既定表示にする', () => {
    expect(read('app/tags/page.tsx')).toContain('<TagsPageV4 accountId={selectedAccountId} />')
    expect(read('app/tags/new/page.tsx')).toContain('<NewTagPageV4 />')
    expect(read('app/tags/edit/page.tsx')).toContain('<EditTagPageV4 />')
  })
})
