'use client'

/*
 * ★V8-B ウェビナー①基本設定（作る）（板 `j7PP04`）。
 *
 * v7 の作る画面（`page.tsx` の NewWebinarPage）とは別の部品として持つ。
 * データの口（フォルダ・保存・未保存の番兵）は同じ。違いは置き場と
 * 見せ方——5段の手順の帯、右に LINE の見え方（本物のスマホ）＋
 * テストを送る、下の帯の主ボタン「動画の設定へ →」。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま）：
 * - 公開ページのURL：見本は `musubo.jp/w/nen-start` だが、公開URLの
 *   ドメインの形は口に無いので、アドレスの最後の部分（slug）だけを
 *   入れる欄にする。空なら今までどおり自動で付ける。
 * - 案内文：申込公開ページの説明（`publicDescription`）へ保存する。
 * - 案内する相手：今の作りは申込者向けで固定なので、選ぶ欄は
 *   「申込者向け」1つだけ出す。
 */
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Button from '@/components/shared/button'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Select from '@/components/shared/select'
import { RequiredBadge } from '@/components/shared/form-controls'
import StickyBar from '@/components/shared/sticky-bar'
import LinePreview from '@/components/shared/line-preview'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { webinarApi, describeSaveFailure, type WebinarFolder } from '@/lib/api'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { STEPS } from '@/app/webinars/edit/edit-steps'
import styles from './new-v8.module.css'

type DeliveryKind = 'on-demand' | 'scheduled'

const FOLDERS_BLOCKED_MESSAGE = 'フォルダを読み込めていないため、下書きを保存できません。フォルダをもう一度読み込んでください。'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function StepBand({ current }: { current: number }) {
  return (
    <ol className={styles.steps} aria-label="ウェビナー作成の進み方">
      {STEPS.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo'
        return (
          <li
            key={step.key}
            className={`${styles.step} ${state === 'done' ? styles.stepDone : state === 'current' ? styles.stepCurrent : ''}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className={styles.stepNum} aria-hidden="true">{state === 'done' ? '✓' : step.no}</span>
            {step.title}
          </li>
        )
      })}
    </ol>
  )
}

export default function NewWebinarV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <NewWebinarV8Inner />
    </Suspense>
  )
}

function NewWebinarV8Inner() {
  usePageTitle('ウェビナーを作る')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [deliveryKind, setDeliveryKind] = useState<DeliveryKind>('on-demand')
  const [folders, setFolders] = useState<WebinarFolder[]>([])
  const [folderId, setFolderId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [foldersState, setFoldersState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [canCreateWebinar] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())

  const dirty = title.trim() !== '' || slug.trim() !== '' || description.trim() !== '' || deliveryKind !== 'on-demand' || folderId !== ''
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
    const slugTrimmed = slug.trim().toLowerCase()
    if (slugTrimmed && !SLUG_PATTERN.test(slugTrimmed)) {
      setError('公開ページのURLは、半角の英小文字・数字・-（ハイフン）だけで入力してください')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const created = await webinarApi.create({
        accountId: selectedAccountId,
        title: title.trim(),
        status: 'draft',
        slug: slugTrimmed || `webinar-${Date.now()}`,
        videoPrefix: null,
        durationSeconds: 120 * 60,
        schedule: [],
        cta: null,
        folderId: folderId || null,
        deliveryKind: deliveryKind === 'on-demand' ? 'on_demand' : 'scheduled',
        viewingCondition: { kind: 'registered', label: '申込者向け' },
        publicDescription: description.trim() || undefined,
      })
      router.push(next === 'video' ? `/webinars/edit?id=${created.data.id}&pane=video` : '/webinars')
    } catch (cause) {
      setError(describeSaveFailure(cause))
      setSaving(false)
    }
  }

  const bubbleTitle = title.trim() || '（ウェビナー名）'
  const bubbleBody = description.trim() || 'セミナーの案内文がここに出ます。'

  return (
    <div className={styles.board} data-design-node="j7PP04">
      <nav className={styles.crumb} aria-label="パンくず">
        <Link href="/webinars" className={styles.crumbLink}>← ウェビナーへ</Link>
      </nav>
      <h1 className={styles.headTitle}>ウェビナーを作る</h1>
      <StepBand current={0} />
      <p className={styles.headDescription}>管理名と公開ページの基本、開催形式を決めます。保存しても、まだ誰にも公開されません。</p>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      <div className={styles.body}>
        <div className={styles.form}>
          <section className={styles.card} aria-labelledby="webinar-v8-basic">
            <h2 className={styles.cardTitle} id="webinar-v8-basic">基本設定</h2>
            <div className={styles.fieldGrid}>
              <div className={styles.fieldFull}>
                <label className={styles.label} htmlFor="webinar-v8-title">名前 <RequiredBadge /></label>
                <input
                  id="webinar-v8-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="NEN活用スタートセミナー"
                  className={styles.input}
                />
              </div>
              <div>
                <label className={styles.label} htmlFor="webinar-v8-slug">公開ページのURL</label>
                <input
                  id="webinar-v8-slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder="nen-start"
                  inputMode="url"
                  className={styles.input}
                />
                <p className={styles.fieldHelp}>アドレスの最後の部分です。空のままなら自動で付けます。</p>
              </div>
              <div>
                <label className={styles.label} htmlFor="webinar-v8-folder">フォルダ</label>
                <Select
                  id="webinar-v8-folder"
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
                  <p className={styles.fieldHelp}>
                    フォルダを読み込めませんでした。{' '}
                    <button type="button" onClick={() => void loadFolders()} className={styles.crumbLink}>
                      もう一度読み込む
                    </button>
                  </p>
                ) : null}
              </div>
              <div className={styles.fieldFull}>
                <label className={styles.label} htmlFor="webinar-v8-description">案内文</label>
                <input
                  id="webinar-v8-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="15分で NEN の使い方がわかる無料セミナーです"
                  className={styles.input}
                />
              </div>
            </div>
          </section>

          <section className={styles.card} aria-labelledby="webinar-v8-kind">
            <h2 className={styles.cardTitle} id="webinar-v8-kind">開催形式</h2>
            <p className={styles.cardNote}>あとから動画の段でも変えられます</p>
            <RadioCardGroup legend="開催形式" className={styles.radioRow}>
              <RadioCard
                name="webinar-v8-delivery-kind"
                value="on-demand"
                checked={deliveryKind === 'on-demand'}
                onChange={() => setDeliveryKind('on-demand')}
                title="オンデマンド配信"
                note="録画動画をいつでも視聴"
              />
              <RadioCard
                name="webinar-v8-delivery-kind"
                value="scheduled"
                checked={deliveryKind === 'scheduled'}
                onChange={() => setDeliveryKind('scheduled')}
                title="日時指定配信"
                note="指定日時に公開開始"
              />
            </RadioCardGroup>
          </section>

          <section className={styles.card} aria-labelledby="webinar-v8-audience">
            <h2 className={styles.cardTitle} id="webinar-v8-audience">だれに案内するか</h2>
            <div className={styles.fieldGrid}>
              <div className={styles.fieldFull}>
                <label className={styles.label} htmlFor="webinar-v8-audience-select">案内する相手</label>
                <Select
                  id="webinar-v8-audience-select"
                  aria-label="案内する相手"
                  value="registered"
                  onChange={() => {}}
                  options={[{ value: 'registered', label: '申込者向け' }]}
                />
                <p className={styles.fieldHelp}>タグ「配信済み」は確認の段で足せます</p>
              </div>
            </div>
          </section>
        </div>

        <aside className={styles.previewCol} aria-label="LINEでの見え方">
          <h2 className={styles.previewTitle}>LINE での見え方</h2>
          <LinePreview>
            <div>
              <p className={styles.previewBubbleTitle}>【無料セミナー】{bubbleTitle}</p>
              <p className={styles.previewBubbleBody}>{bubbleBody}<br />▶申込はこちら</p>
            </div>
          </LinePreview>
          <div className={styles.testRow}>
            <Button disabled title="下書き保存後に使えます">テストを送る</Button>
          </div>
        </aside>
      </div>

      {!canCreateWebinar ? (
        <p className={styles.fieldHelp}>ウェビナーの作成はオーナーか管理者が行います。必要なときは依頼してください。</p>
      ) : null}
      <StickyBar
        status="下書き（まだ誰にも公開されません）"
        actions={(
          <>
            <Button href="/webinars">キャンセル</Button>
            <Button
              disabled={saving || !canCreateWebinar || foldersState === 'error'}
              title={
                !canCreateWebinar
                  ? 'ウェビナーの作成はオーナーか管理者が行います'
                  : foldersState === 'error'
                    ? 'フォルダを読み込めていないため保存できません'
                    : undefined
              }
              onClick={() => void save('list')} busy={saving}>下書きを保存
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
              → 動画の設定へ
            </Button>
          </>
        )}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
