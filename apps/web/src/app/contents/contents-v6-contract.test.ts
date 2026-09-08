import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const UPLOAD = readFileSync(new URL('./media-upload-dialog.tsx', import.meta.url), 'utf8')
const DETAIL = readFileSync(new URL('./media-detail-dialog.tsx', import.meta.url), 'utf8')
const REPLACEMENT = readFileSync(new URL('./media-replacement-dialog.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')
const WORKER = readFileSync(new URL('../../../../worker/src/routes/contents.ts', import.meta.url), 'utf8')

describe('V6 登録メディア一覧の契約', () => {
  it('V6の実Nodeと共通状態部品を使う', () => {
    expect(PAGE).toContain('data-design-node="g89Tc"')
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('kind="empty"')
  })

  it('本文に画面タイトルと準備中のマニュアルを重ねない', () => {
    expect(PAGE).not.toContain("import Header from")
    expect(PAGE).not.toContain('マニュアルは準備中です')
  })

  it('未取得の使用数を0件に見せない', () => {
    expect(PAGE).toContain("? '使用先を確認できません'")
    expect(PAGE).toContain("item.usageCount === 0")
    expect(PAGE).toContain("? 'どこでも使っていない'")
    expect(PAGE).toContain('`${item.usageCount}か所で使用中`')
  })

  it('使っていないメディアだけを一覧で絞り込める', () => {
    expect(PAGE).toContain("import FilterChip from '@/components/shared/filter-chip'")
    expect(PAGE).toContain('selected={showUnusedOnly}')
    expect(PAGE).toContain('unusedOnly: showUnusedOnly')
    expect(PAGE).toContain('使っていない')
  })

  it('既存の寸法・長さ・容量をカードへ出し、作り物の値で埋めない', () => {
    expect(PAGE).toContain('item.width != null && item.height != null')
    expect(PAGE).toContain('item.durationMs != null')
    expect(PAGE).toContain('formatMediaSize(item.sizeBytes)')
    expect(PAGE).not.toContain("details.push('—')")
  })

  it('並び順と表示件数を選べる', () => {
    expect(PAGE).toContain("const [sort, setSort] = useState<MediaSort>('newest')")
    expect(PAGE).toContain('入れた日が新しい順')
    expect(PAGE).toContain('使われている順')
    expect(PAGE).toContain('sort,')
    expect(PAGE).toContain('const [pageSize, setPageSize] = useState(20)')
    expect(PAGE).toContain('PAGE_SIZE_OPTIONS')
    expect(PAGE).toContain('offset: (page - 1) * pageSize')
    expect(PAGE).toContain('setTotal(res.data.total)')
  })

  it('保存容量APIの実値で使用量と上限付近を表示する', () => {
    expect(PAGE).toContain('使っている容量')
    expect(PAGE).toContain('api.media.quota(accountAtRequest)')
    expect(PAGE).toContain('quota.usageBytes')
    expect(PAGE).toContain('quota.limitBytes')
    expect(PAGE).toContain('quota.remainingBytes')
    expect(PAGE).toContain('style={{ width')
    expect(PAGE).toContain('selected={showNearLimitOnly}')
    expect(PAGE).toContain('nearLimitOnly: showNearLimitOnly')
  })

  it('格子と一覧の切り替えを持つ', () => {
    expect(PAGE).toContain("const [view, setView] = useState<MediaView>('grid')")
    expect(PAGE).toContain('aria-label="並べ方"')
    expect(PAGE).toContain('格子で並べる')
    expect(PAGE).toContain('一覧で並べる')
    expect(PAGE).toContain('aria-pressed={view === value}')
  })

  it('設計の実測どおりの高さと文字にする', () => {
    // アップロードは一覧へ常設せず、全面のモーダルで開く。
    expect(PAGE).toContain('setUploadOpen(true)')
    expect(UPLOAD).toContain('data-design-node="eXAJP"')
    expect(UPLOAD).toContain('ここにファイルをドラッグ、または押して選ぶ')
    expect(UPLOAD).toContain('LINEで送れる大きさ（超えると入れられません）')
    // 検索: 幅420まで。表示切替: 枠40・各44。
    expect(PAGE).toContain('min-w-64 max-w-[420px] flex-1')
    expect(PAGE).toContain('rounded-control flex h-10 items-center overflow-hidden border')
    expect(PAGE).toContain('flex h-full w-11 items-center justify-center')
    // カード: サムネイル112、ファイル名12/700、形式・容量10/600、使用状況10/700。
    expect(PAGE).toContain("view === 'grid' ? 'h-28' : 'h-14 w-20 shrink-0'")
    expect(PAGE).toContain('truncate text-caption font-bold')
    expect(PAGE).toContain('text-ink-faint text-nano font-semibold tabular-nums')
    expect(PAGE).toContain('text-nano font-bold tabular-nums')
  })

  it('フォルダを取得し、未分類と分けて一覧を絞り込む', () => {
    expect(PAGE).toContain("api.folders.list('media')")
    expect(PAGE).toContain("api.folders.create({ kind: 'media', name })")
    expect(PAGE).toContain('folderId: folderFilter || undefined')
    expect(PAGE).toContain('<FolderPanel')
  })

  it('詳細では取得済みメタデータと使用先を表示し、安全確認後に新版を追加する', () => {
    expect(PAGE).toContain('<MediaDetailDialog')
    expect(DETAIL).toContain('data-design-node="voJtX"')
    expect(DETAIL).toContain('api.media.deleteImpact')
    expect(DETAIL).toContain('名前と管理用URLを保ったまま新しい版を追加します。')
    expect(DETAIL).toContain('api.media.prepareUploads')
    expect(DETAIL).toContain('api.media.completeUpload')
    expect(DETAIL).toContain('api.media.previewVersion')
    expect(DETAIL).toContain('api.media.createVersion')
    expect(DETAIL).toContain('変更理由')
    expect(DETAIL).toContain('固定版は変わりません')
  })

  it('詳細を一覧上の小窓ではなく、設計の全面詳細として描く', () => {
    expect(PAGE).toContain('if (detailsFor)')
    expect(PAGE).toContain('<MediaDetailDialog')
    expect(DETAIL).not.toContain("import Dialog from '@/components/shared/dialog'")
    expect(DETAIL).toContain('xl:grid-cols-3')
    expect(DETAIL).toContain('xl:col-span-2')
    expect(DETAIL).toContain('この{item.kind === \'image\' ? \'画像\' : \'メディア\'}を差し替える')
    expect(DETAIL).toContain('使われているあいだは削除できません')
  })

  it('署名URLへ直接送り、LINE上限・個別進捗・再試行を持つ', () => {
    expect(UPLOAD).toContain("{ label: '音声', note: 'MP3・M4A ／ 200MBまで' }")
    expect(UPLOAD).toContain("{ label: '動画', note: 'MP4 ／ 200MBまで' }")
    expect(UPLOAD).toContain('api.media.prepareUploads')
    expect(UPLOAD).toContain('putMediaFile')
    expect(UPLOAD).toContain('api.media.completeUpload')
    expect(UPLOAD).toContain('保存先へ直接送ります')
    expect(UPLOAD).toContain('aria-live="polite"')
    expect(UPLOAD).toContain('この1件を再試行')
    expect(UPLOAD).toContain("entry.state === 'uploading'")
  })

  it('既存メディアへの一括差し替えは影響確認後の版を渡して実行する', () => {
    expect(PAGE).toContain('<MediaReplacementDialog')
    expect(REPLACEMENT).toContain('api.media.replacementImpact')
    expect(REPLACEMENT).toContain('api.media.replaceUsages')
    expect(REPLACEMENT).toContain('expectedRevision: impact.revision')
    expect(REPLACEMENT).toContain('disabled={busy || !impact?.canReplace}')
  })

  it('差し替え候補も一覧の200件上限に依存しない', () => {
    expect(REPLACEMENT).toContain('excludeId: source.id')
    expect(REPLACEMENT).toContain('limit: 50')
    expect(REPLACEMENT).toContain('candidatePage * 50 >= candidateTotal')
  })

  it('使用中メディアの強制削除口を持たない', () => {
    expect(PAGE).not.toContain('force: true')
    expect(PAGE).toContain('使用先から外すまで削除できません')
    expect(API).not.toContain("`/api/media/${id}${opts?.force ? '?force=1' : ''}`")
  })

  it('使用先を取得できないメディアを未使用として選択・削除しない', () => {
    expect(PAGE).toContain('function isKnownUnused(item: MediaItem)')
    expect(PAGE).toContain('return item.usageCount === 0')
    expect(PAGE).toContain('const removable = items.filter(isKnownUnused)')
    expect(PAGE).toContain('disabled={!isKnownUnused(item)}')
    expect(PAGE).toContain('使用先を確認できないため選べません')
    expect(PAGE).toContain('removableSelected.length !== selected.size')
    expect(PAGE).not.toContain('item.usageCount === undefined || item.usageCount === 0')
  })

  it('選択中のLINEアカウントを一覧・登録・変更・使用先・削除へ渡す', () => {
    expect(PAGE).toContain('api.media.list(accountAtRequest, {')
    expect(PAGE).toContain('latestAccountRef.current')
    expect(API).toContain("q.set('accountId', accountId)")
    expect(WORKER).toContain("c.req.query('accountId')")
    expect(WORKER).toContain('canAccessAllLineAccounts')
  })

  it('ブラウザ申告だけでなく実ファイル形式を確認する', () => {
    expect(WORKER).toContain('hasMediaSignature(signatureBytes, session.expected_mime)')
    expect(WORKER).toContain('failMediaUploadSession')
  })
})

/** N-197（票 #667）staff に編集・削除の押し口を見せない。 */
describe('N-197 編集・削除は権限とAPIに一致させる', () => {
  it('自分の役割を読み、owner/adminだけを通す', () => {
    expect(PAGE).toContain('api.staff.me()')
    expect(PAGE).toContain("response.data.role === 'owner' || response.data.role === 'admin'")
    expect(PAGE).toContain('canManageMedia')
  })

  it('権限のない人には編集・削除の押し口を出さない', () => {
    // 押して403になるボタンを出さない。読む・入れる・取り出す口は残す。
    expect(PAGE).toContain('{canManageMedia ? (')
    expect(PAGE).toContain('選択したメディアを削除')
    expect(PAGE).toContain('addFolderDisabled={!canManageMedia}')
  })

  it('出さない・無効化する理由を画面に書く', () => {
    expect(PAGE).toContain('名前の変更・削除は管理者だけができます')
    expect(PAGE).toContain('フォルダの追加は管理者だけができます')
  })

  it('編集系の口はowner/admin限定のまま', () => {
    expect(WORKER).toContain("contents.patch('/api/media/:id', requireRole('owner', 'admin')")
    expect(WORKER).toContain("contents.delete('/api/media/:id', requireRole('owner', 'admin')")
    expect(WORKER).toContain("contents.get('/api/media/:id/delete-impact', requireRole('owner', 'admin')")
    expect(WORKER).toContain("contents.post('/api/media/:id/replace-usages', requireRole('owner', 'admin')")
  })

  it('一覧・登録・版追加・受取はstaffのまま（読取と編集を混同しない）', () => {
    expect(WORKER).toContain("requireRole('owner', 'admin', 'staff')")
    expect(PAGE).toContain('setUploadOpen(true)')
    expect(PAGE).toContain('ダウンロード')
  })
})
