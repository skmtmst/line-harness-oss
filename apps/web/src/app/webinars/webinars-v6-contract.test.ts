import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const EDIT = fs.readFileSync(path.join(__dirname, 'edit/page.tsx'), 'utf8')
const PUBLISHED = fs.readFileSync(path.join(__dirname, 'published/page.tsx'), 'utf8')
const API = fs.readFileSync(path.join(__dirname, '../../lib/api.ts'), 'utf8')
const FORM = fs.readFileSync(path.join(__dirname, '../../components/webinars/webinar-form.tsx'), 'utf8')
/** 読み込めなかった理由の文言は、試験しやすいよう別ファイルへ出した。 */
const FAILURE = fs.readFileSync(path.join(__dirname, 'webinar-load-failure.ts'), 'utf8')

describe('V6 ウェビナー一覧の契約', () => {
  it('既存データで判定できる並び順と表示件数だけを選べる', () => {
    expect(PAGE).toContain('更新が新しい順')
    expect(PAGE).toContain('作成が新しい順')
    expect(PAGE).toContain('名前順')
    /* 共通の `SelectField` へ寄せたので、配列ではなく options で並ぶ。 */
    for (const n of ['20件表示', '50件表示', '100件表示']) expect(PAGE).toContain(n)
    expect(PAGE).toContain('setPageSize(Number(event.target.value))')
    expect(PAGE).not.toContain('申込が多い順')
    expect(PAGE).not.toContain('表示件数の切り替えは準備中です')
  })

  it('公開中と下書きの条件をサーバーで絞り込む', () => {
    /* 取った1頁を画面で絞り直すと件数や頁数が変わる。絞りは口へ渡す。 */
    expect(PAGE).toContain('status: savedFilter || undefined')
    expect(PAGE).toContain("{ key: 'active', label: '公開中のみ' }")
    expect(PAGE).toContain("{ key: 'draft', label: '下書きのみ' }")
    expect(PAGE).not.toContain('保存した条件は準備中です')
    expect(PAGE).not.toContain('foldered.filter')
  })

  it('選択アカウントのフォルダ件数を表示し、追加・改名・並び替え・削除を保存する', () => {
    expect(PAGE).toContain('lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]')
    expect(PAGE).toContain('style={FOLDER_RAIL_STYLE}')
    expect(PAGE).toContain("onAddFolder={() => { setFolderError(''); setFolderDialogOpen(true) }}")
    expect(PAGE).toContain("webinarApi.createFolder(selectedAccountId, { name })")
    expect(PAGE).toContain('webinarApi.updateFolder(selectedAccountId, editingFolder.id, { name })')
    expect(PAGE).toContain('webinarApi.deleteFolder(selectedAccountId, deletingFolder.id)')
    expect(PAGE).toContain('webinarApi.folders(selectedAccountId)')
    expect(PAGE).toContain('count: folder.count')
    /* 未分類の絞りはサーバーへ渡す(絞り値は UNFILED 行の id)。 */
    expect(PAGE).toContain("{ id: UNFILED, label: '未分類', count: unfiledCount }")
    expect(PAGE).not.toContain('const WEBINAR_FOLDERS')
    expect(PAGE).not.toContain('min-h-[640px]')
    expect(PAGE).not.toContain('フォルダ名と件数は一覧APIへの接続後に表示します。')
    expect(PAGE).toContain('measuredCount(w.registrationCount)')
    expect(PAGE).toContain('measuredCount(w.viewerCount)')
    expect(PAGE).toContain('publicationSummary(w)')
  })

  it('選択中のLINEアカウントだけを読み、新規作成にも所属を保存する', () => {
    expect(PAGE).toContain('webinarApi.list(accountId, {')
    expect(PAGE).toContain('currentGeneration: () => requestGeneration.current')
    expect(PAGE).toContain('loadedAccountId === selectedAccountId ? items : []')
    expect(PAGE).toContain('folderRequestGeneration.current === generation')
    expect(PAGE).toContain('上のバーでLINE公式アカウントを選んでください')
    expect(FORM).toContain("...(!initial ? { accountId: selectedAccountId } : {})")
  })

  it('一覧は頁ごとに取り、取った頁を絞り直さない', () => {
    expect(PAGE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGE).toContain('limit: pageSize')
    expect(PAGE).toContain('q: debouncedQuery.trim() || undefined')
    expect(PAGE).toContain('folder: selectedFolder || undefined')
    expect(PAGE).toContain('sort: sortKey')
    expect(PAGE).toContain('!Array.isArray(res.data.items) || typeof res.data.total !==')
    expect(PAGE).toContain('pageCount={pageCount}')
    expect(PAGE).not.toContain('ほかに {hiddenCount} 件あります')
    expect(PAGE).not.toContain('.slice(visibleStart, visibleStart + pageSize)')
  })

  it('取得失敗を空の一覧と混ぜず、同じ画面で再取得できる', () => {
    /*
      文言は `webinar-load-failure.ts` へ移した。**理由ごとに言い分ける**
      ようにしたので、1つの文字列を画面に直書きする形ではなくなっている。
    */
    expect(FAILURE).toContain('ウェビナーを表示できませんでした')
    expect(FAILURE).toContain('通信状態を確認して、もう一度読み込んでください。')
    expect(PAGE).not.toContain('e instanceof Error ? e.message')
    expect(PAGE).toContain('onRetry={() => void refresh()}')
    expect(PAGE).toContain('もう一度読み込む')
    /* 失敗の1枚と、空の1枚が別であること。 */
    expect(PAGE).toContain('if (loadFailure)')
    expect(PAGE).toContain('if (visibleItems.length === 0)')
  })

  it('固定の絞り込みは「よく使う絞り込み」と呼び、保存検索と混ぜない(DETAIL-20)', () => {
    /* 公開中のみ・下書きのみはコード固定の切替で、利用者の保存検索ではない。 */
    expect(PAGE).toContain('よく使う絞り込み')
    expect(PAGE).not.toContain('保存した条件')
  })

  it('同じ /webinars/new への操作名は「ウェビナーを作成」で一致する(DETAIL-02)', () => {
    expect(PAGE).toContain('href="/webinars/new">ウェビナーを作成')
    expect(PAGE).not.toContain('ウェビナーを作る')
  })

  it('動画欄は実メディア名を出し、slug.mp4 の偽名を作らない(DETAIL-18)', () => {
    expect(EDIT).not.toContain('webinar.slug}.mp4')
    expect(EDIT).toContain('設定済みの動画')
    expect(EDIT).toContain('api.media')
    expect(EDIT).toContain('media.filename')
  })

  it('通知概要の状態は1つの定義から描き、成功色に固定しない(DETAIL-19)', () => {
    expect(EDIT).toContain('NOTIFICATION_ROW_STATE')
    expect(EDIT).toContain('NotificationStateBadge')
    /* 文言だけ変えて緑固定だった欠陥形は残さない */
    expect(EDIT).not.toContain('text-success text-xs font-semibold">{enabled(')
    expect(EDIT).not.toContain('const enabled = ')
  })

  it('使っていない計算・状態を残さない(DETAIL-21)', () => {
    expect(EDIT).not.toContain('completionRate')
  })

  it('物理削除ではなく履歴を残すアーカイブ確認を使う', () => {
    expect(PAGE).toContain('ウェビナーをアーカイブしますか？')
    expect(PAGE).toContain('申込者・視聴履歴・CTA・分析結果は消えません')
    expect(PAGE).toContain('webinarApi.archive(archiveTarget.id)')
    expect(API).toContain("method: 'POST'")
    expect(API).not.toContain('webinarApi.remove')
  })

  it('視聴後アクション・参加者・分析・公開プレビューを別の面で開ける', () => {
    for (const label of ['視聴後アクション', '公開プレビュー', '参加者', '分析']) {
      expect(EDIT).toContain(`'${label}'`)
    }
    expect(EDIT).toContain('webinarApi.saveActions(webinarId, actions)')
    // #1053: 直リンクは Bearer 補完経路で401になるため、認証付き取得へ。
    expect(EDIT).toContain('downloadApiFile(webinarApi.participantsCsvUrl(webinarId')
    expect(EDIT).toContain('data-design-node="Xjk8q"')
    expect(EDIT).toContain('data-design-node="Q8sHa"')
    expect(EDIT).toContain('data-design-node="yxyzQ"')
  })

  it('アーカイブ確認の背景はPCメニューのある幅だけ左を空け、狭い幅は全幅で縦に読める（#985 CHK-02）', () => {
    const backdrop = PAGE.slice(
      PAGE.indexOf('function ArchiveReviewBackdrop'),
      PAGE.indexOf('const WebinarsPageWithTestSupport'),
    )
    // 左256pxと上56pxはPCのメニュー・上部バー（1280px以上）が実在する間だけ。
    expect(backdrop).toContain('xl:left-64 xl:top-14')
    // 狭い幅は縦に読めるよう切り捨てない。
    expect(backdrop).toContain('overflow-y-auto')
    // コメント文ではなく className 属性の中に overflow-hidden が無いこと。
    expect(backdrop.match(/className="[^"]*overflow-hidden/g) ?? []).toHaveLength(0)
    // 全幅で左を空ける `left-64` 単独指定へは戻さない。
    expect(backdrop).not.toContain(' left-64 ')
  })

  it('アーカイブの失敗は対象を失わず同じ窓で伝える（#985 CHK-02）', () => {
    expect(PAGE).toContain('setArchiveError')
    // 成功したときだけ対象を閉じる。
    expect(PAGE).toContain('setArchiveTarget(null)')
    // 処理中にキャンセルで閉じない。
    expect(PAGE).toContain('if (!archiving) setArchiveTarget(null)')
  })

  it('残り12画面を実ノードと直接開ける面に分ける', () => {
    for (const node of ['PV1Vh', 'd3rFGD', 'Ho8z4', 'Xjk8q', 'GB0NR', 'D6yO7e', 'Q8sHa', 'yxyzQ']) {
      expect(EDIT).toContain(`data-design-node="${node}"`)
    }
    expect(PAGE).toContain('data-design-node="ZC13r"')
    expect(PAGE).toContain('data-design-node="LKuAQ"')
    for (const pane of ['video', 'cta', 'notifications', 'actions', 'preview', 'review', 'participants', 'analytics']) {
      /* keep-alive した面は `hidden={pane !== '...'}` で畳む。直接開ける面は `pane === '...'` のまま */
      expect(EDIT.includes(`pane === '${pane}'`) || EDIT.includes(`pane !== '${pane}'`)).toBe(true)
    }
  })

  it('編集・公開前検査・運用・参加者・分析を実APIへ接続する', () => {
    for (const call of [
      'webinarApi.editor(id)',
      'webinarApi.publishValidation(webinar.id)',
      'webinarApi.participants(webinarId, undefined, PARTICIPANTS_PAGE_SIZE, participantFilter || undefined)',
      'webinarApi.participants(webinarId, nextCursor, PARTICIPANTS_PAGE_SIZE, participantFilter || undefined)',
      'webinarApi.testPublicPage(webinar.id, editor.version)',
    ]) expect(EDIT).toContain(call)
    for (const call of [
      'webinarApi.pause(id, editor.version)',
      'webinarApi.testNotifications(id)',
      'webinarApi.duplicate(id, editor.version)',
    ]) expect(PUBLISHED).toContain(call)
    expect(EDIT).toContain('analytics.viewSegments')
    expect(PUBLISHED).toContain('editor.monitoring.notificationFailures')
  })
})
