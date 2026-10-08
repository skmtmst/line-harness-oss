'use client'

/*
 * ★V8 重複候補を比べて決める（Pencil `fcg2D`：判定の小窓を開いた形、1152 は `p15At`：閉じた形）。
 * /friends/identity-candidates（`?id=` で候補を指定。無ければ未判定の先頭）。
 *
 * 読み込み・判定は今と同じ口（components/identity の useIdentityReview：
 * 一覧・詳細・判定・版の照合）。判定の中身も今と同じ（理由は必須・結び付けるときは
 * 採用する値と3つの確認）。違いは見せ方だけ：
 * - 判定は窓ではなく「結び付けた人に使う値」の中に開く小窓。下の帯の3つのボタンが開く
 * - 採用する値は表の「使う値」で選ぶ（小窓はその要約）
 * - 判定の履歴は小窓の右に出す
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CircleHelp, Link2, UserX } from 'lucide-react'
import type { IdentityCandidateDecision } from '@line-crm/shared'
import type { IdentityCandidateWithProfiles } from '@/lib/api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Radio from '@/components/shared/radio'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { IdentityStateBlock } from '@/components/identity/identity-state'
import { useIdentityReview } from '@/components/identity/identity-review'
import { canSubmitDecision } from '@/components/identity/identity-view'
import { CONFIDENCE_WORD, STATUS_WORD, slashDateTime } from '../duplicates/words'
import styles from './compare.module.css'

const STRENGTH_WORD = { strong: '決め手', medium: '手がかり', weak: '参考' } as const
const ATTRIBUTE_WORD: Record<string, string> = { メールアドレス: 'メール', 電話番号: '電話' }
const DECISIONS: Array<{ value: IdentityCandidateDecision; label: string }> = [
  { value: 'linked', label: '同じ人' },
  { value: 'different', label: '別の人' },
  { value: 'deferred', label: '保留' },
]
/* 結び付けるときの3つの確認（絵 fcg2D の文）。3つそろうまで判定できない。 */
const CONSENTS = ['利用目的の範囲で結び付ける', '本人の同意（または正当な理由）がある', 'あとで戻せることを知っている']

function CompareInner() {
  usePageTitle('重複候補を比べて決める')
  /* 板の頭の「← 〇〇へ」は 2026-10-08 に無くした。一覧へは上の帯のパンくずで戻る。 */
  usePageCrumbs([{ label: '友だち', href: '/friends' }, { label: '重複検出', href: '/friends?tab=duplicates' }])
  const review = useIdentityReview('friend_duplicate')
  const searchParams = useSearchParams()
  const wantedId = searchParams.get('id')
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

  const detail = review.detail as IdentityCandidateWithProfiles | null
  const profileCandidates = useMemo(() => (detail && 'profileCandidates' in detail ? detail.profileCandidates : []), [detail])
  const tagCandidates = detail && 'tagCandidates' in detail ? detail.tagCandidates : []
  const decisive = detail?.evidence.find((item) => item.strength === 'strong') ?? detail?.evidence[0]

  /* ── 判定の小窓 ── */
  const [panelOpen, setPanelOpen] = useState(false)
  const [decision, setDecision] = useState<IdentityCandidateDecision>('linked')
  const [reason, setReason] = useState('')
  const [consents, setConsents] = useState([false, false, false])
  const [selections, setSelections] = useState<Record<string, string>>({})
  const panelRef = useRef<HTMLDivElement>(null)

  // 別の候補を開いたら、前の候補の入力を持ち越さない。
  useEffect(() => {
    setPanelOpen(false)
    setReason('')
    setConsents([false, false, false])
    setSelections(Object.fromEntries(profileCandidates.flatMap((field) => (field.options[0] ? [[field.fieldKey, field.options[0].sourceFriendId]] : []))))
  }, [detail?.id, profileCandidates])

  const openPanel = (next: IdentityCandidateDecision) => {
    setDecision(next)
    setPanelOpen(true)
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }

  const linkedReady = decision !== 'linked' || (
    profileCandidates.every((field) => Boolean(selections[field.fieldKey])) && consents.every(Boolean)
  )
  const ready = Boolean(detail) && canSubmitDecision({ canDecide: detail?.canDecide ?? false, reason, busy: review.deciding }) && linkedReady

  const submit = () => {
    if (!detail || !ready) return
    review.decide({
      decision,
      reason: reason.trim(),
      ...(decision === 'linked' ? {
        profileSelections: profileCandidates.map((field) => ({
          fieldKey: field.fieldKey,
          sourceFriendId: selections[field.fieldKey],
          updateMode: 'fixed' as const,
        })),
      } : {}),
    })
  }

  const sideLetter = (friendId: string | undefined) => (!detail || !friendId ? '' : friendId === detail.left.id ? 'A' : friendId === detail.right.id ? 'B' : '')
  const firstSelection = profileCandidates[0]
  const firstChosen = firstSelection?.options.find((option) => option.sourceFriendId === selections[firstSelection.fieldKey])
  const selectionSummary = firstChosen
    ? `採用する値：表で選んだ値（${sideLetter(firstChosen.sourceFriendId)}：${firstChosen.valuePreview ?? '未登録'}${profileCandidates.length > 1 ? ' ほか' : ''}）`
    : '採用する値：表で選んだ値'

  return (
    <PageFrame kind="detail" boardId="fcg2D">
      <header className={styles.head}>
        <h2 className={styles.title}>{detail ? `${detail.left.label} ↔ ${detail.right.label}` : '重複候補を比べて決める'}</h2>
        <p className={styles.description}>
          {detail ? `確からしさ：${CONFIDENCE_WORD[detail.confidence.label]}${decisive ? `・根拠：${decisive.label}` : ''}` : '同じ人かどうかを、根拠を見て決めます'}
        </p>
      </header>

      <div className={styles.body}>
        <IdentityStateBlock
          state={review.state}
          failure={review.failure}
          emptyTitle="確認する候補はありません"
          emptyDescription="同じ人の疑いが見つかると、ここに並びます。"
          onRetry={review.reload}
        />

        {review.state === 'ready' && detail ? (
          <>
            <p className={styles.band}>
              <Link2 size={16} aria-hidden="true" />
              <span>結び付けても、元の友だち・注文・LINEアカウントは消えません。2件は残したまま、同じ人として扱います。一斉配信は結び付けた人へ1通になります。</span>
            </p>

            <div className={styles.pair}>
              {[{ side: '候補 A', subject: detail.left }, { side: '候補 B', subject: detail.right }].map(({ side, subject }) => (
                <section key={side} className={styles.subject} aria-label={side}>
                  <p className={styles.side}>{side}</p>
                  <p className={styles.subjectName}>{subject.label}</p>
                  <p className={styles.subjectSub}>{[subject.detail, subject.lineAccountName].filter(Boolean).join('・') || '—'}</p>
                  <dl className={styles.attrs}>
                    {subject.attributes.map((attribute) => (
                      <div key={attribute.label} className={styles.attr}>
                        <dt>{ATTRIBUTE_WORD[attribute.label] ?? attribute.label}</dt>
                        <dd className={styles.mono}>{attribute.valuePreview ?? '—（未取得）'}</dd>
                        <dd>{attribute.verified ? <span className={`${styles.pill} ${styles.pillOk}`}>確認済み</span> : <span className={`${styles.pill} ${styles.pillMuted}`}>未確認</span>}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>

            <div className={styles.pair}>
              <section className={styles.card} aria-labelledby="compare-evidence">
                <h3 id="compare-evidence" className={styles.cardTitle}>根拠</h3>
                <ul className={styles.lines}>
                  {detail.evidence.map((item) => (
                    <li key={item.key} className={styles.line}>
                      <span title={item.valuePreview ?? undefined}>{item.label}</span>
                      <span className={item.strength === 'strong' ? styles.strong : styles.weak}>{STRENGTH_WORD[item.strength]}</span>
                    </li>
                  ))}
                </ul>
                <p className={styles.cardNote}>名前やプロフィール画像だけの一致は、決め手にしません。</p>
              </section>
              <section className={styles.card} aria-labelledby="compare-impact">
                <h3 id="compare-impact" className={styles.cardTitle}>結び付けたときの影響</h3>
                <ul className={styles.lines}>
                  {detail.impact.map((metric) => (
                    <li key={metric.key} className={styles.line}>
                      <span>{metric.label}</span>
                      <span className={styles.lineValue} title={metric.note ?? undefined}>
                        {metric.value === null ? '—（つないだあとに出ます）' : `${metric.value}${metric.unit}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section className={styles.card} aria-labelledby="compare-values">
              <h3 id="compare-values" className={styles.cardTitle}>結び付けた人に使う値</h3>

              {panelOpen ? (
                <div className={styles.pair}>
                  <div ref={panelRef} className={styles.panel} role="group" aria-labelledby="compare-decide">
                    <p id="compare-decide" className={styles.panelTitle}>「この2件を判定する」の小窓</p>
                    <div className={styles.radios} role="radiogroup" aria-label="判定">
                      {DECISIONS.map((item) => (
                        <Radio key={item.value} name="compare-decision" value={item.value} checked={decision === item.value} onChange={() => setDecision(item.value)}>
                          {item.label}
                        </Radio>
                      ))}
                    </div>
                    {decision === 'linked' ? (
                      <>
                        <p className={styles.fieldBox}>過去の扱い：これまでの履歴を1人分にまとめる</p>
                        <p className={styles.fieldBox}>{selectionSummary}</p>
                        <div className={styles.checks}>
                          {CONSENTS.map((label, index) => (
                            <Checkbox
                              key={label}
                              checked={consents[index]}
                              onCheckedChange={(checked) => setConsents((current) => current.map((value, itemIndex) => (itemIndex === index ? checked : value)))}
                            >
                              {label}
                            </Checkbox>
                          ))}
                        </div>
                      </>
                    ) : null}
                    <label className={styles.fieldLabel} htmlFor="compare-reason">判定の理由（必須）</label>
                    <TextField
                      id="compare-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder={decisive ? `${decisive.label}` : '何を見てそう判断したか'}
                    />
                    {review.decideError ? <p className={styles.error} role="alert">{review.decideError}</p> : null}
                    {!ready && reason.trim() !== '' && decision === 'linked' && !linkedReady ? (
                      <p className={styles.note} role="status">3つの確認をそろえると判定できます。</p>
                    ) : null}
                    <div className={styles.panelActions}>
                      <Button type="button" variant="secondary" onClick={() => setPanelOpen(false)} disabled={review.deciding}>キャンセル</Button>
                      <Button type="button" variant="primary" onClick={submit} disabled={!ready} busy={review.deciding} busyLabel="処理中…">判定する</Button>
                    </div>
                  </div>
                  <div className={styles.historyCard}>
                    <p className={styles.panelTitle}>判定の履歴</p>
                    <ul className={styles.lines}>
                      {detail.history.map((item) => (
                        <li key={item.id} className={styles.historyLine}>
                          <span>{slashDateTime(item.decidedAt)}</span>
                          <span>{`${STATUS_WORD[item.toStatus]}・${item.actorName}「${item.reason}」`}</span>
                        </li>
                      ))}
                      <li className={styles.historyLine}>
                        <span>{slashDateTime(detail.detectedAt)}</span>
                        <span>{`候補に上がった（${decisive?.label ?? '根拠を確認'}）`}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              ) : null}

              <DataTable className={styles.table}>
                <colgroup>
                  <col className={styles.colItem} />
                  <col />
                  <col />
                  <col className={styles.colUse} />
                </colgroup>
                <thead>
                  <TableHeadRow>
                    <Th className={styles.th}>項目</Th>
                    <Th className={styles.th}>候補A</Th>
                    <Th className={styles.th}>候補B</Th>
                    <Th className={styles.th}>使う値</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {profileCandidates.map((field) => {
                    const left = field.options.find((option) => option.sourceFriendId === detail.left.id)
                    const right = field.options.find((option) => option.sourceFriendId === detail.right.id)
                    const same = left?.valuePreview != null && left.valuePreview === right?.valuePreview
                    return (
                      <Tr key={field.fieldKey} className={styles.row}>
                        <Td className={styles.td}><span className={styles.itemName}>{field.fieldLabel === 'メールアドレス' ? 'メール' : field.fieldLabel}</span></Td>
                        <Td className={styles.td}>{left?.valuePreview ?? '—'}</Td>
                        <Td className={styles.td}>{right?.valuePreview ?? '—'}</Td>
                        <Td className={styles.td}>
                          <Select
                            aria-label={`${field.fieldLabel}に使う値`}
                            size="full"
                            value={selections[field.fieldKey] ?? ''}
                            disabled={!detail.canDecide}
                            onChange={(value) => setSelections((current) => ({ ...current, [field.fieldKey]: value }))}
                            options={field.options.map((option, index) => ({
                              value: option.sourceFriendId,
                              label: same && index === 0 ? '同じ' : `${sideLetter(option.sourceFriendId) || option.sourceLabel}：${option.valuePreview ?? '未登録'}`,
                            }))}
                          />
                        </Td>
                      </Tr>
                    )
                  })}
                  {tagCandidates.length > 0 ? (
                    <Tr className={styles.rowPlain}>
                      <Td className={styles.td}><span className={styles.itemName}>タグ</span></Td>
                      <Td className={styles.td}>{tagCandidates.filter((tag) => tag.sourceFriendIds.includes(detail.left.id)).map((tag) => tag.name).join('・') || '—'}</Td>
                      <Td className={styles.td}>{tagCandidates.filter((tag) => tag.sourceFriendIds.includes(detail.right.id) && !tag.sourceFriendIds.includes(detail.left.id)).map((tag) => tag.name).join('・') || '—'}</Td>
                      <Td className={styles.td}><span className={styles.faint}>元の友だちに残す</span></Td>
                    </Tr>
                  ) : null}
                </tbody>
              </DataTable>
            </section>

            <div className={styles.footer}>
              <div className={styles.footerBar}>
                <Button type="button" variant="secondary" disabled={!detail.canDecide || review.deciding} onClick={() => openPanel('different')}>
                  <UserX size={14} aria-hidden="true" />
                  別の人だった
                </Button>
                <div className={styles.footerCenter}>
                  <Button type="button" variant="secondary" disabled={!detail.canDecide || review.deciding} onClick={() => openPanel('deferred')}>
                    <CircleHelp size={14} aria-hidden="true" />
                    あとで決める（保留）
                  </Button>
                  <Button type="button" variant="primary" disabled={!detail.canDecide || review.deciding} onClick={() => openPanel('linked')}>
                    <Link2 size={14} aria-hidden="true" />
                    同じ人として結び付ける
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </PageFrame>
  )
}

export default function CompareV8() {
  return (
    <Suspense fallback={null}>
      <CompareInner />
    </Suspense>
  )
}
