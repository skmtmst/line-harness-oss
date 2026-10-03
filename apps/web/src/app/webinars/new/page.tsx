'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Button from '@/components/shared/button'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Select from '@/components/shared/select'
import { RequiredBadge } from '@/components/shared/form-controls'
import Stepper from '@/components/shared/stepper'
import StickyBar from '@/components/shared/sticky-bar'
import LinePreview from '@/components/shared/line-preview'
import Notice from '@/components/shared/notice'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { Suspense } from 'react'
import { useAdminTheme } from '@/lib/use-admin-theme'
import ListState from '@/components/shared/list-state'
import NewWebinarV8 from './new-v8'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { webinarApi, describeSaveFailure, type WebinarFolder } from '@/lib/api'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
/* 段の並びは編集画面と同じ定義を使う。作る画面と直す画面で段がずれないようにする。 */
import { STEPS } from '@/app/webinars/edit/edit-steps'

type DeliveryKind = 'on-demand' | 'scheduled'

/* D003: フォルダ未取得のまま保存しようとしたときの止め文。 */
const FOLDERS_BLOCKED_MESSAGE = 'フォルダを読み込めていないため、下書きを保存できません。フォルダをもう一度読み込んでください。'

export default function NewWebinarPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <NewWebinarPageThemed />
    </Suspense>
  )
}

/*
 * ★V8 切替（①基本設定 `j7PP04`）。v7 の見た目は data-theme="v8" が付くまで
 * 1画素も変えない。
 */
function NewWebinarPageThemed() {
  const theme = useAdminTheme()
  if (theme === 'v8') return <NewWebinarV8 />
  return <NewWebinarPageV7 />
}

function NewWebinarPageV7() {
  usePageTitle('ウェビナーを作成')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [title, setTitle] = useState('')
  const [deliveryKind, setDeliveryKind] = useState<DeliveryKind>('on-demand')
  const [folders, setFolders] = useState<WebinarFolder[]>([])
  const [folderId, setFolderId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
   * D003: フォルダ一覧が読めていない間（取得失敗）は、存在しないはずの
   * 「未分類」だけを見て保存させない。失敗は欄の下に出し、再読み込みで
   * 直せるようにする。
   */
  const [foldersState, setFoldersState] = useState<'loading' | 'ready' | 'error'>('loading')
  /*
   * D001（new）: 作成の口は owner/admin だけ（POST /api/webinars の
   * requireRole とそろえる）。閲覧だけの担当者の保存は理由付きで止める。
   */
  const [canCreateWebinar] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())

  /*
   * R18: 名前・開催形式・フォルダのいずれかを触っていたら未保存とみなす。
   * リッチメニュー作成と同じ共通の番兵（離れる・Esc・保存せず移動）で守る。
   * 保存成功後の router.push は番兵の対象外（リンク押下・戻る・再読込だけ止める）。
   */
  const dirty = title.trim() !== '' || deliveryKind !== 'on-demand' || folderId !== ''
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const loadFolders = useCallback(async () => {
    if (!selectedAccountId) {
      setFolders([])
      setFolderId('')
      setFoldersState('ready')
      return
    }
    setFoldersState('loading')
    try {
      const response = await webinarApi.folders(selectedAccountId)
      setFolders(response.success && Array.isArray(response.data) ? response.data : [])
      setFoldersState('ready')
      /* 再読み込みで直ったら、保存止めの文は消す（入力は残る）。 */
      setError((previous) => (previous === FOLDERS_BLOCKED_MESSAGE ? null : previous))
    } catch {
      setFolders([])
      setFoldersState('error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  async function save(next: 'list' | 'video') {
    if (!canCreateWebinar) {
      setError('ウェビナーを作る権限がありません。オーナーか管理者に依頼してください。')
      return
    }
    if (!selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    if (foldersState === 'error') {
      setError(FOLDERS_BLOCKED_MESSAGE)
      return
    }
    if (!title.trim()) {
      setError('ウェビナー名を入力してください')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const created = await webinarApi.create({
        accountId: selectedAccountId,
        title: title.trim(),
        status: 'draft',
        slug: `webinar-${Date.now()}`,
        videoPrefix: null,
        durationSeconds: 120 * 60,
        schedule: [],
        cta: null,
        folderId: folderId || null,
        deliveryKind: deliveryKind === 'on-demand' ? 'on_demand' : 'scheduled',
        viewingCondition: { kind: 'registered', label: '申込者向け' },
      })
      /*
        動画設定へ進むときは `pane=video` を付ける。付けないと編集画面は
        先頭の基本設定で開き、選んだはずの段に着かない。
      */
      router.push(next === 'video' ? `/webinars/edit?id=${created.data.id}&pane=video` : '/webinars')
    } catch (cause) {
      /* D002: `API error: 405` のような内部文をそのまま出さない。 */
      setError(describeSaveFailure(cause))
      setSaving(false)
    }
  }

  return (
    <div
      data-design-node="lvaY5"
      // U054: 外側の左右余白は app-shell が持つ（16px/24px/40px）。
      // ここで px を重ねるとスマホで入力幅が二重に削られる。
      className="mx-auto flex max-w-screen-2xl flex-col gap-4 pb-28 pt-4"
    >
      <nav data-design="Crumb" className="text-ink-faint text-xs">
        <Link href="/webinars" className="text-action hover:underline">← ウェビナー一覧</Link>
      </nav>

      <Stepper
        label="ウェビナー作成の進み方"
        steps={STEPS.map((step, index) => ({ label: step.title, state: index === 0 ? 'current' as const : 'todo' as const }))}
      />

      {error ? (
        <Notice tone="danger" className="mt-4">{error}</Notice>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-4">
        <div className="space-y-4 xl:col-span-3">
          <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
            <h2 className="text-ink text-base font-bold">基本設定</h2>
            <p className="text-ink-faint mt-1 text-xs">管理名と公開ページの基本情報を設定します。</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <label htmlFor="webinar-title" className="text-ink-secondary mb-1 block text-sm font-medium">
                  ウェビナー名 <RequiredBadge />
                </label>
                <input
                  id="webinar-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="はじめての定期便セミナー"
                  className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="webinar-folder" className="text-ink-secondary mb-1 block text-sm font-medium">フォルダ</label>
                <Select
                  id="webinar-folder"
                  aria-label="フォルダ"
                  value={folderId}
                  disabled={foldersState === 'error'}
                  onChange={(value) => setFolderId(value)}
                  options={[
                    { value: '', label: '未分類' },
                    ...folders.map((folder) => ({ value: folder.id, label: `${folder.name}（${folder.count}件）` })),
                  ]}
                />
                {foldersState === 'error' ? (
                  <p className="mt-1 text-xs">
                    <span className="text-danger">フォルダを読み込めませんでした。</span>{' '}
                    <button
                      type="button"
                      onClick={() => void loadFolders()}
                      className="text-action text-xs font-semibold underline"
                    >
                      もう一度読み込む
                    </button>
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
            <h2 className="text-ink text-base font-bold">開催形式</h2>
            <p className="text-ink-faint mt-1 text-xs">公開方法と視聴形式を選びます。</p>
            <RadioCardGroup legend="開催形式" className="mt-4">
              <RadioCard
                name="delivery-kind"
                value="on-demand"
                checked={deliveryKind === 'on-demand'}
                onChange={() => setDeliveryKind('on-demand')}
                title="オンデマンド配信"
                note="録画動画をいつでも視聴"
              />
              <RadioCard
                name="delivery-kind"
                value="scheduled"
                checked={deliveryKind === 'scheduled'}
                onChange={() => setDeliveryKind('scheduled')}
                title="日時指定配信"
                note="指定日時に公開開始"
              />
            </RadioCardGroup>
            <p className="text-ink-faint mt-3 text-xs">選んだ開催形式は下書き版へ保存され、動画設定でも変更できます。</p>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
            <h2 className="text-ink text-sm font-bold">設定サマリー</h2>
            <dl className="divide-hairline mt-4 divide-y text-xs">
              <div className="flex justify-between py-3"><dt className="text-ink-faint">状態</dt><dd className="text-ink font-semibold">下書き</dd></div>
              <div className="flex justify-between py-3"><dt className="text-ink-faint">動画</dt><dd className="text-ink font-semibold">未設定</dd></div>
              <div className="flex justify-between py-3"><dt className="text-ink-faint">公開</dt><dd className="text-ink font-semibold">非公開</dd></div>
            </dl>
            <p className="text-ink mt-3 text-xs font-semibold">タグ「配信済み」は確認画面で追加できます</p>
          </section>

          <div className="shadow-card">
          <LinePreview
            note="実際のLINE表示に近いプレビューです"
          >
            <div className="bg-canvas text-ink min-h-12 rounded-control p-4 text-sm font-medium">
              {title.trim() ? `${title.trim()}へようこそ。` : 'ウェビナー名を入れると、案内文をここで確認できます。'}
            </div>
          </LinePreview>
          </div>
          <div className="flex gap-2">
            <Button disabled title="下書き保存後に使えます">テストを送る</Button>
            <Button disabled title="公開後に使えます">公開ページを見る</Button>
          </div>
        </aside>
      </div>

      {!canCreateWebinar ? (
        <p className="text-ink-secondary text-xs">ウェビナーの作成はオーナーか管理者が行います。必要なときは依頼してください。</p>
      ) : null}
      <StickyBar
        status="下書き（まだ誰にも公開されません）"
        actions={(
          <>
            <Button
              disabled={saving || !canCreateWebinar || foldersState === 'error'}
              title={
                !canCreateWebinar
                  ? 'ウェビナーの作成はオーナーか管理者が行います'
                  : foldersState === 'error'
                    ? 'フォルダを読み込めていないため保存できません'
                    : undefined
              }
              onClick={() => void save('list')} busy={saving}>下書きを保存する
            </Button>
            <Button
              variant="primary"
              disabled={saving || !canCreateWebinar || foldersState === 'error'}
              title={
                !canCreateWebinar
                  ? 'ウェビナーの作成はオーナーか管理者が行います'
                  : foldersState === 'error'
                    ? 'フォルダを読み込めていないため保存できません'
                    : undefined
              }
              onClick={() => void save('video')}
            >
              動画設定へ
            </Button>
          </>
        )}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
