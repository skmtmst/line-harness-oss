'use client'

/*
 * ★V8 重複候補の確認（Pencil `fcg2D`、採用版の流れは `sdbsQ` 板2。
 * 再撮の板 `p15At`（1152）を A/B の並びに付ける）。
 *
 * v7（InCDe）と同じ `useIdentityReview` を使う。違いは見せ方——
 * 頭に「← 重複検出へ」、A/B を同じ高さで並べ、判定は最下段の追従帯
 * 「別の人だった／あとで決める（保留）／同じ人として結び付ける」から
 * 判定窓を開く（理由はどの判定でも必須。Worker が必須にしている）。
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import type { IdentityCandidateDecision } from '@line-crm/shared'
import Button from '@/components/shared/button'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import StickyBar from '@/components/shared/sticky-bar'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import IdentityDecisionDialog from '@/components/identity/identity-decision-dialog'
import {
  IdentityAssurance,
  IdentityEvidenceList,
  IdentityHistoryList,
  IdentityImpactList,
  IdentitySubjectCard,
  StatusTag,
} from '@/components/identity/identity-parts'
import { IdentityStateBlock } from '@/components/identity/identity-state'
import { useIdentityReview } from '@/components/identity/identity-review'
import { confidenceText } from '@/components/identity/identity-view'
import styles from '@/app/friends/friends-v8.module.css'

function FriendIdentityCandidatesV8Inner() {
  usePageTitle('重複候補の確認')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '友だち', href: '/friends' },
  ])
  const review = useIdentityReview('friend_duplicate')
  const searchParams = useSearchParams()
  /*
   * 重複検出の表の「根拠を確認」は `?id=` を付けて来る。URLの候補が
   * あればそれを、無ければ未判定の先頭を開く（読む対象の無い画面にしない）。
   */
  const wantedId = searchParams.get('id')
  const [presetDecision, setPresetDecision] = useState<IdentityCandidateDecision>('linked')

  /*
   * `?id=` は「その候補を最初に開く」指示。判定が済んで候補が pending 一覧から
   * 外れても同じ id を開き直さないよう、一度だけ適用する（そのあとは先頭へ）。
   */
  const appliedWantedRef = useRef(false)
  const first = review.items[0] ?? null
  useEffect(() => {
    if (review.state !== 'ready' || review.selectedId) return
    if (wantedId && !appliedWantedRef.current) {
      appliedWantedRef.current = true
      review.select(wantedId)
    } else if (first) {
      review.select(first.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.state, review.selectedId, first?.id, wantedId])

  const detail = review.detail
  const profileCandidates = detail && 'profileCandidates' in detail ? detail.profileCandidates : []
  const tagCandidates = detail && 'tagCandidates' in detail ? detail.tagCandidates : []
  const decisive = detail?.evidence.find((item) => item.strength === 'strong') ?? detail?.evidence[0]

  const openDecision = (decision: IdentityCandidateDecision) => {
    if (!detail) return
    setPresetDecision(decision)
    review.openDialog(detail.id)
  }

  return (
    <div className={styles.board} data-design-node="fcg2D">
      <div className={styles.manageNav}>
        <nav aria-label="データ管理の中の現在地" className={styles.manageCrumbs}>
          <Link href="/friends">
            <ArrowLeft size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> 友だち一覧
          </Link>
          <span className={styles.sep} aria-hidden="true">›</span>
          <Link href="/friends?tab=duplicates">重複検出</Link>
          <span className={styles.sep} aria-hidden="true">›</span>
          <span className={styles.here} aria-current="page">候補の確認</span>
        </nav>
      </div>

      <IdentityStateBlock
        state={review.state}
        failure={review.failure}
        emptyTitle="確認する候補はありません"
        emptyDescription="同じ人の疑いが見つかると、ここに並びます。"
        onRetry={review.reload}
      />

      {review.state === 'ready' && detail ? (
        <>
          <div className={styles.head}>
            <div className={styles.headText}>
              <h2 className={styles.headTitle}>
                {detail.left.label} ↔ {detail.right.label}
              </h2>
              <p className={styles.headDescription}>
                確からしさ：{confidenceText(detail.confidence.label)}
                {decisive ? `・根拠：${decisive.label}` : ''}
              </p>
            </div>
            <div className={styles.headAction}>
              <StatusTag status={detail.status} />
            </div>
          </div>

          <IdentityAssurance>
            2件の友だちは残したまま、同じ人として結び付けます。一斉配信は結び付けた人へ1通になります。
          </IdentityAssurance>

          {/* A/B は同じ高さで並べる（fcg2D）。狭い板では縦に積む（1152 は `p15At`）。 */}
          <div className={styles.duoCards} data-design-node="p15At">
            <IdentitySubjectCard side="候補A" subject={detail.left} />
            <IdentitySubjectCard side="候補B" subject={detail.right} />
          </div>

          <div className={styles.duoCards}>
            <IdentityEvidenceList evidence={detail.evidence} confidence={detail.confidence} />
            <IdentityImpactList impact={detail.impact} />
          </div>

          {profileCandidates.length > 0 || tagCandidates.length > 0 ? (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>結び付けた人に使う値</h3>
              <p className={styles.sectionDesc}>
                「同じ人として結び付ける」を選んだあとの小窓で、使う値を確かめて決めます。
              </p>
              <div className={styles.tableWrap} style={{ border: 0 }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>項目</th>
                      <th>候補A</th>
                      <th>候補B</th>
                      <th>使う値</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileCandidates.map((field) => {
                      const left = field.options.find((option) => option.sourceFriendId === detail.left.id)
                      const right = field.options.find((option) => option.sourceFriendId === detail.right.id)
                      const same =
                        left?.valuePreview != null &&
                        left?.valuePreview === right?.valuePreview
                      return (
                        <tr key={field.fieldKey}>
                          <td style={{ color: 'var(--color-ink)', fontWeight: 600 }}>{field.fieldLabel}</td>
                          <td>{left?.valuePreview ?? '—'}</td>
                          <td>{right?.valuePreview ?? '—'}</td>
                          <td>
                            {same
                              ? '同じ'
                              : field.options[0]
                                ? `${field.options[0].sourceLabel}：${field.options[0].valuePreview ?? '未登録'}`
                                : '判定時に選択'}
                          </td>
                        </tr>
                      )
                    })}
                    {tagCandidates.length > 0 ? (
                      <tr>
                        <td style={{ color: 'var(--color-ink)', fontWeight: 600 }}>タグ</td>
                        <td colSpan={2}>{tagCandidates.map((tag) => tag.name).join('・')}</td>
                        <td>元の友だちに残す</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <IdentityHistoryList history={detail.history} />

          {/*
           * fcg2D の追従帯。左「別の人だった」／中央「あとで決める（保留）」・
           * 主「同じ人として結び付ける」。どれを押しても判定窓が開き、
           * 理由（必須）を書いて確定する。
           */}
          <StickyBar
            destructive={
              <Button
                type="button"
                disabled={!detail.canDecide || review.deciding}
                onClick={() => openDecision('different')}
              >
                別の人だった
              </Button>
            }
            status={<StatusTag status={detail.status} />}
            actions={
              <>
                <Button
                  type="button"
                  disabled={!detail.canDecide || review.deciding}
                  onClick={() => openDecision('deferred')}
                >
                  あとで決める（保留）
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  data-qa-open="fcg2D"
                  disabled={!detail.canDecide || review.deciding}
                  onClick={() => openDecision('linked')}
                >
                  同じ人として結び付ける
                </Button>
              </>
            }
          />

          <IdentityDecisionDialog
            open={review.dialogOpen}
            candidate={detail}
            busy={review.deciding}
            error={review.decideError || undefined}
            initialDecision={presetDecision}
            onCancel={review.closeDialog}
            onSubmit={review.decide}
          />
        </>
      ) : null}
    </div>
  )
}

/*
 * 結び付け候補の読み込み枠（サクサク感 A）。板・段・4列の表の形の骨組み。
 * 光は共通 `Skeleton`。出す・消すの判定は `DelayedSkeleton` が持つ。
 */
function CandidatesSuspenseFallback() {
  return (
    <DelayedSkeleton
      loading
      skeleton={(
        <div className={styles.board} aria-hidden="true">
          <Skeleton width={200} height={24} />
          <section className={styles.section}>
            <Skeleton width={180} height={16} />
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>候補A</th>
                    <th>候補B</th>
                    <th>使う値</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 3, 4].map((n) => (
                    <tr key={n}>
                      <td><Skeleton width="60%" height={13} /></td>
                      <td><Skeleton width="70%" height={13} /></td>
                      <td><Skeleton width="70%" height={13} /></td>
                      <td><Skeleton width="60%" height={13} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    />
  )
}

export default function FriendIdentityCandidatesV8() {
  return (
    <Suspense fallback={<CandidatesSuspenseFallback />}>
      <FriendIdentityCandidatesV8Inner />
    </Suspense>
  )
}
