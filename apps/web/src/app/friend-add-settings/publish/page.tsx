'use client'

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type {
  FriendAddRoutingPublishResult,
  FriendAddRoutingValidation,
  FriendAddRoutingVersion,
} from '@line-crm/shared'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import PageHeader from '@/components/shared/page-header'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import {
  audienceText,
  blockedReason,
  canPublish,
  checkStatusText,
  idempotencyKeyFor,
  monitoringLink,
  NOT_AVAILABLE,
} from './publish-flow'
import styles from './publish.module.css'

/**
 * 友だち追加時配信の公開（設計 `ec9vg` 最終確認 ／ `quhg6` 有効化完了）。
 *
 * 2画面は**同じ流れの前後**なので1つのファイルに置く。公開が返ってきたら
 * 完了の面へ差し替える。別ルートにすると、公開の返事を持ち回すために
 * 保存先が要るか、完了画面で読み直すことになる——**読み直すと、
 * 公開したときの数と完了画面の数が食い違い得る。**
 *
 * 出せないときは4つに分ける。読込・空（下書きが無い）・失敗・権限不足。
 * 空を失敗にしない。失敗を0件にしない。
 */
type Phase = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden'

const STEPS = ['基本設定', '流入条件', '初回案内', 'アクション', '確認']

/**
 * 5段の進み表示（設計 `ec9vg` / `quhg6` の STEP 1〜5）。
 *
 * **どこまで済んでいるかが読めないと、戻ってよいのか分からない。**
 * 共通の部品はこの枝に無いので、この画面のぶんだけ置く。
 */
function StepTrail({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className={styles.steps} aria-label="設定の進み">
      {steps.map((label, index) => {
        const done = index + 1 < current
        const now = index + 1 === current
        return (
          <li key={label} className={styles.step} aria-current={now ? 'step' : undefined}>
            <span className={`${styles.stepMark} ${done ? styles.stepDone : now ? styles.stepNow : ''}`}>
              {done ? '✓' : index + 1}
            </span>
            <span className={styles.stepText}>
              <span className={styles.stepNo}>STEP {index + 1}</span>
              <span className={styles.stepLabel}>{label}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function FriendAddPublishInner() {
  const { selectedAccountId } = useAccount()
  const [phase, setPhase] = useState<Phase>('loading')
  const [draft, setDraft] = useState<FriendAddRoutingVersion | null>(null)
  const [validation, setValidation] = useState<FriendAddRoutingValidation | null>(null)
  const [published, setPublished] = useState<FriendAddRoutingPublishResult | null>(null)
  const [failure, setFailure] = useState<{ title: string; description: string } | null>(null)
  const [publishError, setPublishError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  /*
    **どのアカウントの、何回目の読み込みかを持つ。**
    アカウントを変えたり読み直したりしたあとに、前の要求の返事が遅れて
    届くことがある。アカウントIDだけでは、同じアカウントで読み直した
    ときの取り違えを止められないので、回数も一緒に見る。
  */
  const requestRef = useRef<{ accountId: string | null; generation: number }>({
    accountId: null,
    generation: 0,
  })

  useEffect(() => {
    if (!selectedAccountId) return
    let alive = true
    const generation = requestRef.current.generation + 1
    requestRef.current = { accountId: selectedAccountId, generation }
    const isCurrent = () =>
      alive
      && requestRef.current.accountId === selectedAccountId
      && requestRef.current.generation === generation
    setPhase('loading')
    setFailure(null)
    /*
      **アカウント固有の結果を先に捨てる。** 消さないと、切替先の取得に
      失敗したときに前のアカウントの下書き・確認・公開の結果が残り、
      別のアカウントの数を見ながら公開することになる。
    */
    setDraft(null)
    setValidation(null)
    setPublished(null)
    setPublishError('')
    ;(async () => {
      try {
        const draftRes = await api.friendAddRouting.getDraft(selectedAccountId)
        if (!isCurrent()) return
        if (!draftRes.success) {
          setFailure({ title: '下書きを読み込めませんでした', description: '時間をおいて読み直してください。' })
          setPhase('error')
          return
        }
        setDraft(draftRes.data)
        /*
          **画面を開くだけで試験を走らせない。** dry-runの返事は
          `stateChanged: false` だが、**Worker側は `last_test_status` と
          `last_tested_at` をDBへ記録する**（`friend-add-routing.ts`）。
          読み込みで呼ぶと、利用者が意図して試験していない下書きでも
          公開条件（試験が成功していること）を満たしてしまう。
          固定の友だちIDを当てるのも同じ理由で危ない。
          最後の試験の結果は、下書きと確認の返事から読む。
        */
        const validationRes = await api.friendAddRouting.validateDraft(selectedAccountId)
        if (!isCurrent()) return
        if (validationRes.success) setValidation(validationRes.data)
        setPhase('ready')
      } catch (error: unknown) {
        if (!isCurrent()) return
        /*
         * 404 は「確認する下書きがない」。**失敗と混ぜない。**
         * 混ぜると、まだ作っていないだけなのに壊れて見える。
         */
        if (error instanceof ApiError && error.status === 404) {
          setPhase('empty')
          return
        }
        if (error instanceof ApiError && error.status === 403) {
          setFailure({
            title: 'この設定を公開する権限がありません',
            description: '見るには権限が要ります。オーナーか管理者に追加を依頼してください。',
          })
          setPhase('forbidden')
          return
        }
        setFailure({ title: '下書きを読み込めませんでした', description: '時間をおいて読み直してください。' })
        setPhase('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [selectedAccountId, reloadKey])

  const publish = useCallback(async () => {
    if (!selectedAccountId || !draft) return
    /*
      **公開中にアカウントを変えられたら、返事を映さない。**
      公開はWorker側で進むが、その結果を**別のアカウントを見ている画面へ
      出すと、切替先で公開したように読める**。押した時点のアカウントと
      読み込み回数を控えておき、戻ってきたときに一致するかを見る。
    */
    const at = { accountId: selectedAccountId, generation: requestRef.current.generation }
    const stillHere = () =>
      requestRef.current.accountId === at.accountId
      && requestRef.current.generation === at.generation
    setBusy(true)
    setPublishError('')
    try {
      const res = await api.friendAddRouting.publish(at.accountId, idempotencyKeyFor(draft))
      if (!stillHere()) return
      if (!res.success) throw new Error('failed')
      setPublished(res.data)
    } catch (error: unknown) {
      if (!stillHere()) return
      const forbidden = error instanceof ApiError && error.status === 403
      setPublishError(
        forbidden
          ? 'この設定を公開する権限がありません。オーナーか管理者に依頼してください。'
          : '有効化できませんでした。状態を読み直してから、もう一度お試しください。',
      )
    } finally {
      if (stillHere()) setBusy(false)
    }
  }, [draft, selectedAccountId])

  if (phase === 'loading') return <ListState kind="loading" />
  if (phase === 'forbidden') {
    return <ListState kind="forbidden" title={failure?.title} description={failure?.description} />
  }
  if (phase === 'empty') {
    return (
      <ListState
        kind="empty"
        title="確認する下書きがありません"
        description="友だち追加時の配信を作ってから、この画面で公開します。"
        action={<Button href="/friend-add-settings">設定へ戻る</Button>}
      />
    )
  }
  if (phase === 'error' || !draft) {
    return (
      <ListState
        kind="error"
        title={failure?.title}
        description={failure?.description}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    )
  }

  /* 公開が返ってきたら完了の面（設計 `quhg6`）へ差し替える。 */
  if (published) return <PublishedView result={published} />

  const blocked = blockedReason(validation)
  const ready = canPublish({ validation, busy })

  return (
    <div className={styles.screen} data-design-node="ec9vg">
      <PageHeader
        breadcrumb={[{ label: '友だち追加時の配信', href: '/friend-add-settings' }, { label: '最終確認' }]}
        title="友だち追加時・最終確認"
        description="有効化すると、新しく追加された友だちへ初回案内を送ります。"
      />
      <StepTrail steps={STEPS} current={5} />

      <div className={styles.split}>
        <div className={styles.main}>
          <Card layout="vertical" className={styles.section} data-friend-add-part="checks">
            <CardHeader title="配信開始前チェック" />
            {validation ? (
              <div className={styles.rows}>
                {validation.checks.map((check) => (
                  <p key={check.key} className={styles.checkRow}>
                    <span className={`${styles.tag} ${check.status === 'passed' ? styles.tagOk : check.status === 'warning' ? styles.tagWarn : styles.tagBad}`}>
                      {checkStatusText(check.status)}
                    </span>
                    <span className={styles.checkLabel}>{check.label}</span>
                    <span className={styles.checkDetail}>{check.detail}</span>
                  </p>
                ))}
                {validation.conflicts.length === 0 ? (
                  <p className={styles.note}>重なっている経路はありません。</p>
                ) : (
                  validation.conflicts.map((conflict) => (
                    <p key={conflict.code} className={styles.warn} role="alert">{conflict.message}</p>
                  ))
                )}
              </div>
            ) : (
              <p className={styles.note}>確認の結果を読み込めませんでした。読み直してから公開してください。</p>
            )}
          </Card>

          <Card layout="vertical" className={styles.section} data-friend-add-part="summary">
            <CardHeader title="最終確認" meta="有効化すると新しく追加された友だちへ初回案内を送ります。" />
            <div className={styles.rows}>
              <Row label="設定名" value={`第${draft.versionNumber}版の下書き`} />
              <Row label="流入条件" value={draft.routing.criteria.firstTime === 'unfollow_count_zero' ? '初回登録・既存友だち除外' : NOT_AVAILABLE} />
              <Row label="送信タイミング" value={draft.routing.firstTime.timing === 'immediate' ? '登録直後' : NOT_AVAILABLE} />
              <Row label="アクション" value={`${draft.routing.firstTime.actions.length}件`} />
              <Row label="対象見込み" value={audienceText(validation?.estimatedAudienceCount)} />
            </div>
            <p className={styles.note}>24時間に1回だけ実行し、LINE公式のあいさつとの二重送信を防ぎます。</p>
          </Card>

          <Card layout="vertical" className={styles.section} data-friend-add-part="test">
            <CardHeader title="最後のテスト送信" />
            {/*
              **ここでは試験を走らせない。** 走らせると、記録だけが付いて
              「試験済み」になってしまう。下書きが持っている記録を読むだけ。
            */}
            <div className={styles.rows}>
              <Row
                label="結果"
                value={draft.lastTestStatus === 'succeeded' ? '成功' : draft.lastTestStatus === 'failed' ? '失敗' : NOT_AVAILABLE}
              />
              <Row label="実施日時" value={draft.lastTestedAt ? draft.lastTestedAt.slice(0, 16).replace('T', ' ') : NOT_AVAILABLE} />
            </div>
            <p className={styles.note}>
              テスト送信は編集画面から実行します。実際の送信・登録・タグ付けはしません。
            </p>
          </Card>
        </div>

        <aside className={styles.side}>
          <Card layout="vertical" className={styles.section} data-friend-add-part="side">
            <CardHeader title="設定サマリー" meta="有効化する内容です。" />
            <div className={styles.rows}>
              <Row label="状態" value="有効化前" />
              <Row label="対象見込み" value={audienceText(validation?.estimatedAudienceCount)} />
              <Row label="二重送信" value="webhookの記録で防ぎます" />
              <Row
                label="最後のテスト"
                value={validation?.lastTestStatus === 'succeeded' ? '成功' : validation?.lastTestStatus === 'failed' ? '失敗' : NOT_AVAILABLE}
              />
            </div>
          </Card>
        </aside>
      </div>

      {publishError ? <p className={styles.warn} role="alert">{publishError}</p> : null}

      <div className={styles.footer}>
        {/* 押せない理由を書く。押せないボタンを黙って出さない。 */}
        <p className={styles.note}>{blocked ?? '確認がすべて終わりました。有効化できます。'}</p>
        <div className={styles.actions}>
          <Button href="/friend-add-settings">戻って修正</Button>
          <Button
            type="button"
            variant="primary"
            data-qa-open="ec9vg"
            disabled={!ready}
            onClick={publish}
          >
            {busy ? '処理中…' : '友だち追加時の配信を有効化'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 有効化完了（設計 `quhg6`）。 */
function PublishedView({ result }: { result: FriendAddRoutingPublishResult }) {
  const monitoring = monitoringLink(result)
  return (
    <div className={styles.screen} data-design-node="quhg6">
      <PageHeader
        breadcrumb={[{ label: '友だち追加時の配信', href: '/friend-add-settings' }, { label: '有効化完了' }]}
        title="友だち追加時・有効化完了"
        description="新しく追加された友だちへ、流入経路に合った初回案内を自動で送ります。"
      />
      <StepTrail steps={STEPS} current={5} />

      <div className={styles.split}>
        <Card layout="vertical" className={styles.section} data-friend-add-part="done">
          <p className={styles.doneTitle}>友だち追加時の配信を有効化しました</p>
          <div className={styles.rows}>
            <Row label="公開した版" value={`第${result.versionNumber}版`} />
            <Row label="公開日時" value={result.publishedAt.slice(0, 16).replace('T', ' ')} />
            <Row label="対象人数" value={audienceText(result.estimatedAudienceCount)} />
            <Row label="二重送信防止" value="有効（webhookの記録で判定）" />
          </div>
          <p className={styles.note}>{monitoring.note}</p>
          <div className={styles.actions}>
            <Button href="/friend-add-settings">一覧へ戻る</Button>
            {/* 無い画面へ送らない。`monitoringPath` があるときだけリンクにする。 */}
            {monitoring.href ? (
              <Button href={monitoring.href} variant="primary" data-qa-open="quhg6">
                配信状況を確認
              </Button>
            ) : null}
          </div>
        </Card>

        <aside className={styles.side}>
          <Card layout="vertical" className={styles.section}>
            <CardHeader title="次にできること" meta="配信中でも下書きを作って安全に変更できます。" />
            <div className={styles.rows}>
              <p className={styles.note}>内容を変えるときは、下書きを作ってからもう一度この画面で公開します。</p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  const missing = value === NOT_AVAILABLE
  return (
    <p className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={`${styles.rowValue} ${missing ? styles.rowValuePending : ''}`}>{value}</span>
    </p>
  )
}

export default function FriendAddPublishPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddPublishInner />
    </Suspense>
  )
}
