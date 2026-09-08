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

  it('公開中と下書きの条件を実際に絞り込む', () => {
    expect(PAGE).toContain("foldered.filter((w) => w.status === savedFilter)")
    expect(PAGE).toContain("{ key: 'active', label: '公開中のみ' }")
    expect(PAGE).toContain("{ key: 'draft', label: '下書きのみ' }")
    expect(PAGE).not.toContain('保存した条件は準備中です')
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
    expect(PAGE).toContain("selectedFolder === UNFILED")
    expect(PAGE).not.toContain('const WEBINAR_FOLDERS')
    expect(PAGE).not.toContain('min-h-[640px]')
    expect(PAGE).not.toContain('フォルダ名と件数は一覧APIへの接続後に表示します。')
    expect(PAGE).toContain('measuredCount(w.registrationCount)')
    expect(PAGE).toContain('measuredCount(w.viewerCount)')
    expect(PAGE).toContain('publicationSummary(w)')
  })

  it('選択中のLINEアカウントだけを読み、新規作成にも所属を保存する', () => {
    expect(PAGE).toContain('webinarApi.list(accountId)')
    expect(PAGE).toContain('requestGeneration.current !== generation')
    expect(PAGE).toContain('loadedAccountId === selectedAccountId ? items : []')
    expect(PAGE).toContain('folderRequestGeneration.current === generation')
    expect(PAGE).toContain('上のバーでLINE公式アカウントを選んでください')
    expect(FORM).toContain("...(!initial ? { accountId: selectedAccountId } : {})")
  })

  it('表示件数を超えたウェビナーも共通ページ送りで確認できる', () => {
    expect(PAGE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGE).toContain('const visibleStart = (currentPage - 1) * pageSize')
    expect(PAGE).toContain('pageCount={pageCount}')
    expect(PAGE).not.toContain('ほかに {hiddenCount} 件あります')
  })

  it('取得失敗を空の一覧と混ぜず、同じ画面で再取得できる', () => {
    /*
      文言は `webinar-load-failure.ts` へ移した。**理由ごとに言い分ける**
      ようにしたので、1つの文字列を画面に直書きする形ではなくなっている。
    */
    expect(FAILURE).toContain('ウェビナーを表示できませんでした')
    expect(FAILURE).toContain('通信状態を確認して、もう一度読み込んでください。')
    expect(PAGE).not.toContain('e instanceof Error ? e.message')
    expect(PAGE).toContain('onClick={() => void refresh()}')
    expect(PAGE).toContain('もう一度読み込む')
    /* 失敗の1枚と、空の1枚が別であること。 */
    expect(PAGE).toContain(') : loadFailure ? (')
    expect(PAGE).toContain(') : visibleItems.length === 0 ? (')
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
    expect(EDIT).toContain('webinarApi.participantsCsvUrl(webinarId)')
    expect(EDIT).toContain('data-design-node="Xjk8q"')
    expect(EDIT).toContain('data-design-node="Q8sHa"')
    expect(EDIT).toContain('data-design-node="yxyzQ"')
  })

  it('残り12画面を実ノードと直接開ける面に分ける', () => {
    for (const node of ['PV1Vh', 'd3rFGD', 'Ho8z4', 'Xjk8q', 'GB0NR', 'D6yO7e', 'Q8sHa', 'yxyzQ']) {
      expect(EDIT).toContain(`data-design-node="${node}"`)
    }
    expect(PAGE).toContain('data-design-node="ZC13r"')
    expect(PAGE).toContain('data-design-node="LKuAQ"')
    for (const pane of ['video', 'cta', 'notifications', 'actions', 'preview', 'review', 'participants', 'analytics']) {
      expect(EDIT).toContain(`pane === '${pane}'`)
    }
  })

  it('編集・公開前検査・運用・参加者・分析を実APIへ接続する', () => {
    for (const call of [
      'webinarApi.editor(id)',
      'webinarApi.publishValidation(webinar.id)',
      'webinarApi.participants(webinarId)',
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
