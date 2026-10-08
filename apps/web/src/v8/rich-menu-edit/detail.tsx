'use client'

/*
 * ★V8 リッチメニューの詳細（公開した・公開の進み）`hKr8f`。一から書いた画面（2026-10-07）。
 *
 * /rich-menus/edit?id=… を手順の指定（?step=）なしで開いたときの画面。
 * 公開中のメニュー：公開の進み・公開の履歴とLINEとの照合・いまの状態を見せ、編集はウィザード（?step=shape）へ。
 * 下書き：見せる物が無いので、そのままウィザードへ送る。
 *
 * 動き（公開の進み・履歴・失敗だけのやり直し・照合と修復・取り下げ・複製）は今の画面
 * （app/rich-menus/edit の PublishProgressSection・PublishHistorySection・一覧の取り下げ）と同じ API・同じ確かめ方。
 * 受け付ける指定・呼ぶ API は BEHAVIOR.md。
 */

import { useSamePageUrl } from '@/lib/use-same-page-url'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Circle, CircleCheck, CircleAlert, CircleX, GitBranch, Pencil, RefreshCw } from 'lucide-react'
import { api, ApiError, type RichMenuPublishRun, type RichMenuTargetPreview } from '@/lib/api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import TargetMissing from '@/components/shared/target-missing'
import { richMenuError, richMenuErrorAll } from '@/v8/rich-menus/errors'
import { audienceOf, progressStatusText, runAudienceText, runStamp, type ProgressStep, type ReconcileDiff } from './model'
import styles from './detail.module.css'

type Group = {
  id: string
  accountId: string
  name: string
  status: string
  isDefaultForAll: boolean
  targetingEnabled: boolean
  updatedAt?: string
}

export default function RichMenuDetailV8({ groupId }: { groupId: string }) {
  const router = useRouter()
  const samePageUrl = useSamePageUrl()
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'リッチメニュー', href: '/rich-menus' }])
  const [group, setGroup] = useState<Group | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  usePageTitle(group?.name ?? 'リッチメニュー')

  const [role, setRole] = useState<string | null>(null)
  const canOperate = role === 'owner' || role === 'admin'

  const [progress, setProgress] = useState<{ steps: ProgressStep[]; message: string | null; failed: boolean } | null>(null)
  const [progressError, setProgressError] = useState(false)
  const [runs, setRuns] = useState<RichMenuPublishRun[] | null>(null)
  const [runsError, setRunsError] = useState('')
  const [diffs, setDiffs] = useState<ReconcileDiff[] | null>(null)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const [fixOpen, setFixOpen] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [preview, setPreview] = useState<RichMenuTargetPreview | null>(null)
  const [taps, setTaps] = useState<number | null | undefined>(undefined)

  const [retryTarget, setRetryTarget] = useState<RichMenuPublishRun | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [republishing, setRepublishing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [unpublishOpen, setUnpublishOpen] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const loadGroup = useCallback(async () => {
    setLoadState('loading')
    try {
      const res = await api.richMenuGroups.get(groupId)
      if (!res.success || !res.data) {
        setLoadState('missing')
        return
      }
      const data = res.data as unknown as Group
      // 下書きは見せる物が無い。直す画面（ウィザードの手順①）へ。
      if (data.status !== 'published') {
        samePageUrl.replace(`/rich-menus/edit?id=${encodeURIComponent(groupId)}&step=shape`)
        return
      }
      setGroup(data)
      setLoadState('ready')
    } catch (caught) {
      setLoadState(caught instanceof ApiError && caught.status === 404 ? 'missing' : 'error')
    }
  }, [groupId, samePageUrl])

  const loadProgress = useCallback(async () => {
    try {
      const res = await api.richMenuGroups.publishProgress(groupId)
      if (!res.success || !res.data || !Array.isArray(res.data.steps)) throw new Error('progress')
      setProgress({ steps: res.data.steps, message: res.data.message, failed: res.data.run?.status === 'failed' })
      setProgressError(false)
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.status === 403)) setProgressError(true)
    }
  }, [groupId])

  const loadRuns = useCallback(async () => {
    try {
      const res = await api.richMenuGroups.publishRuns(groupId)
      if (!res.success || !res.data || !Array.isArray(res.data.runs)) throw new Error('runs')
      setRuns(res.data.runs)
      setRunsError('')
    } catch (caught) {
      setRunsError(caught instanceof ApiError && caught.status === 403 ? '公開の履歴を見る権限がありません。' : '公開の履歴を読み込めませんでした。')
    }
  }, [groupId])

  /* 照合：読むだけ（dryRun）。ずれを並べ、直すかは運用者が決める（K-2）。 */
  const check = useCallback(async () => {
    setChecking(true)
    setCheckError('')
    try {
      const res = await api.richMenuGroups.reconcile(groupId, true)
      if (!res.success || !res.data || !Array.isArray(res.data.diffs)) throw new Error('reconcile')
      setDiffs(res.data.diffs)
      setCheckedAt(new Date())
    } catch {
      setCheckError('LINEとの照合ができませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setChecking(false)
    }
  }, [groupId])

  useEffect(() => { void loadGroup() }, [loadGroup])
  useEffect(() => {
    if (loadState !== 'ready') return
    void loadProgress()
    void loadRuns()
    void check()
    void api.staff.me().then((res) => { if (res.success) setRole(res.data.role) }).catch(() => {})
  }, [loadState, loadProgress, loadRuns, check])
  useEffect(() => {
    if (!group) return
    let cancelled = false
    void api.richMenuGroups.previewTargets(group.id).then((res) => { if (!cancelled && res.success) setPreview(res.data) }).catch(() => {})
    void api.richMenuGroups.tapStats(group.accountId).then((res) => {
      if (cancelled) return
      setTaps(res.success ? res.data.byGroup.find((row) => row.groupId === group.id)?.taps ?? 0 : null)
    }).catch(() => { if (!cancelled) setTaps(null) })
    return () => { cancelled = true }
  }, [group])

  const latestRun = useMemo(() => (runs ?? []).find((run) => run.status !== 'running') ?? null, [runs])
  const latestSucceeded = useMemo(() => (runs ?? []).find((run) => run.status === 'succeeded') ?? null, [runs])

  const reloadAll = useCallback(async () => {
    await Promise.all([loadGroup(), loadProgress(), loadRuns()])
  }, [loadGroup, loadProgress, loadRuns])

  /* 公開が途中で止まったときの「もう一度公開する」。保存済みの下書きのまま公開し直す。 */
  const republish = async () => {
    if (republishing) return
    setRepublishing(true)
    setActionError('')
    try {
      const res = await api.richMenuGroups.publish(groupId, crypto.randomUUID())
      if (!res.success) throw new Error(res.error)
      setNotice('もう一度公開しました。公開の進みを確かめてください。')
      await reloadAll()
    } catch (caught) {
      setActionError(caught instanceof ApiError && caught.status === 409
        ? 'ほかの人が先に公開・編集しました。読み直してから、もう一度お試しください。'
        : '公開できませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setRepublishing(false)
    }
  }

  /* 失敗した公開だけのやり直し（保存された版のまま。新しい版は作らない）。 */
  const retry = async () => {
    if (!retryTarget || retrying) return
    setRetrying(true)
    setDialogError('')
    try {
      const res = await api.richMenuGroups.retryPublishRun(groupId, retryTarget.id)
      if (!res.success) throw new Error(res.error)
      setRetryTarget(null)
      setNotice('失敗した公開をやり直しました。最新の状態を確かめてください。')
      await reloadAll()
    } catch (caught) {
      setDialogError(caught instanceof ApiError && caught.status === 409
        ? 'すでにやり直されたか、新しい公開があります。読み直して確かめてください。'
        : 'やり直せませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setRetrying(false)
    }
  }

  /* 照合で見つかったずれを直す（確かめてから）。 */
  const fix = async () => {
    if (fixing) return
    setFixing(true)
    setDialogError('')
    try {
      const res = await api.richMenuGroups.reconcile(groupId, false)
      if (!res.success) throw new Error(res.error)
      setFixOpen(false)
      setNotice('LINEとのずれを直しました。')
      await check()
      await loadRuns()
    } catch {
      setDialogError('ずれを直せませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setFixing(false)
    }
  }

  const unpublish = async () => {
    if (unpublishing) return
    setUnpublishing(true)
    setDialogError('')
    try {
      const res = await api.richMenuGroups.unpublish(groupId)
      if (!res.success) throw new Error(res.error)
      setUnpublishOpen(false)
      router.push('/rich-menus')
    } catch (caught) {
      setDialogError(richMenuError(caught, 'unpublish'))
    } finally {
      setUnpublishing(false)
    }
  }

  const duplicate = async () => {
    if (duplicating) return
    setDuplicating(true)
    setDialogError('')
    try {
      const res = await api.richMenuGroups.duplicate(groupId, crypto.randomUUID())
      if (!res.success) throw new Error(res.error)
      setDuplicateOpen(false)
      router.push(`/rich-menus/edit?id=${encodeURIComponent(res.data.id)}&step=shape`)
    } catch (caught) {
      setDialogError(richMenuErrorAll(caught, 'duplicate'))
    } finally {
      setDuplicating(false)
    }
  }

  if (loadState === 'missing') {
    return <TargetMissing kind="not-found" title="このリッチメニューは見つかりません" description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。" backHref="/rich-menus" backLabel="リッチメニュー一覧へ戻る" />
  }
  if (loadState === 'error') {
    return <TargetMissing kind="error" title="リッチメニューを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void loadGroup()} />
  }
  const backLink = <Link href="/rich-menus" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />リッチメニューへ</Link>
  if (!group) return <div className={styles.loadingHead}>{backLink}<p className={styles.loading} role="status">読み込み中…</p></div>

  const audience = audienceOf(group)
  const head = latestSucceeded ? `公開しました・${runStamp(latestSucceeded.updatedAt)}` : '公開中'
  const failed = progress?.failed === true
  const menuItems: ActionMenuItem[] = [
    { id: 'duplicate', label: '複製する', onSelect: () => { setDialogError(''); setDuplicateOpen(true) } },
    { id: 'unpublish', label: 'LINEから取り下げる', onSelect: () => { setDialogError(''); setUnpublishOpen(true) } },
    { id: 'delete', label: '削除する', tone: 'danger', dividerBefore: true, disabled: true, disabledReason: '公開中は消せません。先にLINEから取り下げてください', onSelect: () => {} },
  ]

  return (
    <div className={styles.page} data-design-node="hKr8f">
      <PageFrame kind="create">
        <PageHeading title={group.name} identity={backLink} description={head} />
        <div className={styles.split}>
          <div className={styles.content}>
            {failed ? (
              <div className={styles.failBand} role="alert">
                <CircleAlert size={18} aria-hidden="true" className={styles.failIcon} />
                <div className={styles.bandText}>
                  <p className={styles.bandTitle}>公開が途中で止まりました</p>
                  <p className={styles.bandNote}>{progress?.message ?? 'それまでの段を元に戻し、前のメニューのままにしました。もう一度公開できます。'}</p>
                </div>
                {canOperate ? <Button variant="primary" onClick={() => void republish()} busy={republishing} busyLabel="公開しています…"><RefreshCw size={14} aria-hidden="true" />もう一度公開する</Button> : null}
              </div>
            ) : progress ? (
              <div className={styles.doneBand} role="status">
                <CircleCheck size={18} aria-hidden="true" className={styles.doneIcon} />
                <div className={styles.bandText}>
                  <p className={styles.bandTitle}>{audience === 'all' ? 'LINEへの登録が終わり、すべての友だちの既定のメニューになりました' : audience === 'targeted' ? 'LINEへの登録が終わり、条件に当てはまる友だちに順に出ます' : 'LINEへの登録が終わりました'}</p>
                  <p className={styles.bandNote}>
                    {audience === 'all'
                      ? '条件で出し分けている人には、いままでどおり上の順番のメニューが出ます。'
                      : audience === 'targeted'
                        ? 'その人に関係する出来事（友だち追加・タグ付けなど）が起きたときに切り替わります。すぐ全員に出るわけではありません。'
                        : '友だちの画面に出すには、一覧の「表示先」で出す相手を決めてください。'}
                  </p>
                </div>
              </div>
            ) : null}
            {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
            {actionError ? <p className={styles.errorText} role="alert">{actionError}</p> : null}

            <section className={styles.card} aria-label="公開の進み">
              <h2 className={styles.cardTitle}>公開の進み</h2>
              {progressError ? <p className={styles.cardNote}>公開の進みを読み込めませんでした。</p> : progress === null ? <p className={styles.cardNote} role="status">読み込み中…</p> : progress.steps.length === 0 ? <p className={styles.cardNote}>まだ公開の記録はありません。</p> : progress.steps.map((step) => (
                <div key={step.key} className={styles.stepRow}>
                  {step.status === 'done' ? <CircleCheck size={18} aria-hidden="true" className={styles.stepOk} />
                    : step.status === 'failed' ? <CircleX size={18} aria-hidden="true" className={styles.stepNg} />
                      : <Circle size={18} aria-hidden="true" className={styles.stepQuiet} />}
                  <span className={styles.stepLabel}>{step.label}</span>
                  <span className={step.status === 'done' ? styles.stateOk : step.status === 'failed' ? styles.stateNg : styles.stateQuiet}>{progressStatusText(step.status)}</span>
                </div>
              ))}
            </section>

            <section className={styles.card} aria-label="公開の履歴とLINEとの照合">
              <div className={styles.cardTitles}>
                <h2 className={styles.cardTitle}>公開の履歴とLINEとの照合</h2>
                <p className={styles.cardNote}>管理画面の記録と、LINE上の状態がずれていないかを見ます</p>
              </div>
              <div className={styles.checkBox}>
                <div className={styles.checkText}>
                  {checkError ? <span className={styles.errorText}>{checkError}</span>
                    : diffs === null ? <span>LINEと照らし合わせています…</span>
                      : diffs.length === 0 ? <span>{`管理画面の記録とLINE上の状態にずれはありませんでした${checkedAt ? `（${runStamp(checkedAt.toISOString(), true)}）` : ''}`}</span>
                        : (
                          <>
                            <span className={styles.diffTitle}>{`${diffs.length}件のずれがあります`}</span>
                            <ul className={styles.diffList}>
                              {diffs.map((diff, index) => <li key={`${diff.kind}-${index}`}>{diff.detail}{diff.fix ? `（${diff.fix.label}）` : ''}</li>)}
                            </ul>
                          </>
                        )}
                </div>
                {diffs && diffs.length > 0 && canOperate ? (
                  <Button variant="secondary" onClick={() => { setDialogError(''); setFixOpen(true) }}>ずれを直す</Button>
                ) : null}
                <button type="button" className={styles.ghostButton} onClick={() => void check()} disabled={checking}>
                  {checking ? '照らし合わせています…' : 'もう一度照らし合わせる'}
                </button>
              </div>
              {runsError ? <p className={styles.cardNote}>{runsError}</p> : runs === null ? null : runs.length === 0 ? <p className={styles.cardNote}>まだ公開の履歴はありません。</p> : (
                <div className={styles.runList}>
                  {runs.map((run) => (
                    <div key={run.id} className={styles.runRow}>
                      <span className={styles.runText}>{`${runStamp(run.createdAt)} ${runAudienceText(run)}`}</span>
                      <span className={styles.runSpacer} />
                      {run.status === 'failed' && canOperate && run.id === latestRun?.id ? (
                        <button type="button" className={styles.linkButton} onClick={() => { setDialogError(''); setRetryTarget(run) }}>失敗だけやり直す</button>
                      ) : null}
                      <span className={run.status === 'succeeded' ? styles.stateOk : run.status === 'failed' ? styles.stateNg : styles.stateQuiet}>
                        {run.status === 'succeeded' ? '成功' : run.status === 'failed' ? '失敗' : '実行中'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className={styles.aside}>
            {canOperate ? (
              <div className={styles.sideActions}>
                <Button href={`/rich-menus/edit?id=${encodeURIComponent(group.id)}&step=shape`} variant="secondary"><Pencil size={14} aria-hidden="true" />編集する</Button>
                <Button href={`/rich-menus/connections?id=${encodeURIComponent(group.id)}`} variant="secondary"><GitBranch size={14} aria-hidden="true" />切替のつながり</Button>
                <RowMenu className={styles.moreButton} label="そのほかの操作" menuLabel={`リッチメニュー「${group.name}」の操作`} items={menuItems} />
              </div>
            ) : (
              <div className={styles.sideActions}>
                <Button href={`/rich-menus/connections?id=${encodeURIComponent(group.id)}`} variant="secondary"><GitBranch size={14} aria-hidden="true" />切替のつながり</Button>
              </div>
            )}
            {canOperate || role === null ? null : <p className={styles.roBand} role="note">閲覧のみで見ています。編集・取り下げは管理者の操作です。</p>}
            <section className={styles.aboutBox} aria-label="いまの状態">
              <h2 className={styles.aboutTitle}>いまの状態</h2>
              <dl className={styles.aboutList}>
                <div className={styles.aboutRow}><dt>状態</dt><dd className={styles.stateOk}>公開中</dd></div>
                <div className={styles.aboutRow}><dt>出す相手</dt><dd>{audience === 'all' ? 'すべての友だち（既定）' : audience === 'targeted' ? '条件に当てはまる友だち' : '登録だけ（出す相手なし）'}</dd></div>
                <div className={styles.aboutRow}><dt>出る人</dt><dd>{preview?.effective.value == null ? '—' : `${preview.effective.value.toLocaleString('ja-JP')}人`}</dd></div>
                <div className={styles.aboutRow}><dt>今月押された</dt><dd>{taps === undefined ? '読み込み中…' : taps === null ? '—' : `${taps.toLocaleString('ja-JP')}回`}</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </PageFrame>

      <ConfirmDialog
        open={retryTarget !== null}
        title="失敗した公開をやり直しますか？"
        description="保存された版のまま、失敗した段からやり直します。新しい版は作りません。"
        confirmLabel="やり直す"
        busy={retrying}
        error={dialogError || undefined}
        onConfirm={() => void retry()}
        onCancel={() => { if (!retrying) setRetryTarget(null) }}
      />
      <ConfirmDialog
        open={fixOpen}
        title="LINEとのずれを直しますか？"
        description="管理画面の記録に合わせて、LINE上のメニューを直します。直したあと、もう一度照らし合わせます。"
        confirmLabel="ずれを直す"
        busy={fixing}
        error={dialogError || undefined}
        onConfirm={() => void fix()}
        onCancel={() => { if (!fixing) setFixOpen(false) }}
      />
      <ConfirmDialog
        open={unpublishOpen}
        title={`「${group.name}」をLINEから取り下げますか？`}
        description={audience === 'all' ? 'すべての友だちの既定のメニューから外れます。ほかの既定のメニューが無ければ、メニューが出なくなる友だちがいます。下書きとして残ります。' : 'LINEから外し、下書きとして残します。'}
        confirmLabel="LINEから取り下げる"
        destructive
        busy={unpublishing}
        error={dialogError || undefined}
        onConfirm={() => void unpublish()}
        onCancel={() => { if (!unpublishing) setUnpublishOpen(false) }}
      />
      <ConfirmDialog
        open={duplicateOpen}
        title={`「${group.name}」を複製しますか？`}
        description="同じ形・画像・ボタンの動きの下書きを作ります。公開中のメニューは変わりません。"
        confirmLabel="複製する"
        busy={duplicating}
        error={dialogError || undefined}
        onConfirm={() => void duplicate()}
        onCancel={() => { if (!duplicating) setDuplicateOpen(false) }}
      />
    </div>
  )
}
