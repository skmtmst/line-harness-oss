'use client'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Clock, Link as LinkIcon, UserX } from 'lucide-react'
import type { IdentityCandidateDecision } from '@line-crm/shared'
import type { IdentityCandidateWithProfiles } from '@/lib/api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import { DashboardColumns } from '@/components/templates'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import Checkbox from '@/components/shared/checkbox'
import Radio from '@/components/shared/radio'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import ListState from '@/components/shared/list-state'
import { IdentityStateBlock } from '@/components/identity/identity-state'
import { useIdentityReview } from '@/components/identity/identity-review'
import { canSubmitDecision } from '@/components/identity/identity-view'
import { CONFIDENCE_WORD, STATUS_WORD, slashDateTime } from '../duplicates/words'
import styles from './compare.module.css'
import { Field } from '@/components/shared/form-controls'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'

/*
 * ★V8 重複候補を比べて決める（Pencil ：判定の小窓を開いた形、1152 は ：閉じた形）。
 * /friends/identity-candidates（`?id=` で候補を指定。無ければ未判定の先頭）。
 *
 * 読み込み・判定は今と同じ口（components/identity の useIdentityReview：
 * 一覧・詳細・判定・版の照合）。判定の中身も今と同じ（理由は必須・結び付けるときは
 * 採用する値と3つの確認）。違いは見せ方だけ：
 * - 判定は窓ではなく「結び付けた人に使う値」の中に開く小窓。下の帯の3つのボタンが開く
 * - 採用する値は表の「使う値」で選ぶ（小窓はその要約）
 * - 判定の履歴は小窓の右に出す
 */

const STRENGTH_WORD = { strong: '決め手', medium: '手がかり', weak: '参考' } as const
const ATTRIBUTE_WORD: Record<string, string> = { メールアドレス: 'メール', 電話番号: '電話' }
const DECISIONS: Array<{ value: IdentityCandidateDecision; label: string }> = [
  { value: 'linked', label: '同じ人' },
  { value: 'different', label: '別の人' },
  { value: 'deferred', label: '保留' },
]
/* 結び付けるときの3つの確認（文）。3つそろうまで判定できない。 */
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
    ? `採用する値：表で選んだ値（${sideLetter(firstChosen.sourceFriendId)}：${firstChosen.valuePreview ?? emptyValue('unconfigured')}${profileCandidates.length > 1 ? ' ほか' : ''}）`
    : '採用する値：表で選んだ値'

  return (
    <PageFrame kind="detail" heightMode="content" boardId="fcg2D">
      <PageHeading title={detail ? `${detail.left.label} ↔ ${detail.right.label}` : '重複候補を比べて決める'}
        help={<>{detail ? `確からしさ：${CONFIDENCE_WORD[detail.confidence.label]}${decisive ? `・根拠：${decisive.label}` : ''}` : '同じ人かどうかを、根拠を見て決めます'}</>} />

      <div className={styles.body}>
        <IdentityStateBlock
          state={review.state}
          failure={review.failure}
          emptyTitle="確認する候補はありません"
          emptyDescription="同じ人の疑いが見つかると、ここに並びます。"
          onRetry={review.reload}
        />

        {review.state === 'ready' && review.selectedId && !detail ? <ListState
          kind={review.detailState === 'forbidden' ? 'forbidden' : review.detailState === 'error' ? 'error' : 'loading'}
          title={review.detailState === 'error' ? '候補の詳細を読み込めませんでした' : undefined}
          description={review.detailFailure?.description}
          onRetry={review.detailState === 'error' ? review.reloadDetail : undefined}
        /> : null}
        {review.state === 'ready' && detail ? (
          <>
            <Notice tone="info" icon={<LinkIcon size={16} aria-hidden="true" />}>
              <span>結び付けても、元の友だち・注文・LINEアカウントは消えません。2件は残したまま、同じ人として扱います。一斉配信は結び付けた人へ1通になります。</span>
            </Notice>

            <div className={styles.pair}>
              {[{ side: '候補 A', subject: detail.left }, { side: '候補 B', subject: detail.right }].map(({ side, subject }) => (
                <section key={side} className={styles.subject} aria-label={side}>
                  <p className={styles.side}>{side}</p>
                  <p className={styles.subjectName}>{subject.label}</p>
                  <p className={styles.subjectSub}>{[subject.detail, subject.lineAccountName].filter(Boolean).join('・') || emptyValue('unknown')}</p>
                  <dl className={styles.attrs}>
                    {subject.attributes.map((attribute) => (
                      <div key={attribute.label} className={styles.attr}>
                        <dt>{ATTRIBUTE_WORD[attribute.label] ?? attribute.label}</dt>
                        <dd className={styles.mono}>{attribute.valuePreview ?? '—（未取得）'}</dd>
                        <dd><StatusBadge dot={false} tone={attribute.verified ? 'success' : 'neutral'}>{attribute.verified ? '確認済み' : '未確認'}</StatusBadge></dd>
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
                <DashboardColumns layout="cards" cardHeight="natural">{[
                  <div key="decision" ref={panelRef} className={styles.panel} role="group" aria-label="この2件の判定"><p id="compare-decide" className={styles.panelTitle}>判定</p>
<div className={styles.radios} role="radiogroup" aria-label="判定">
                      {DECISIONS.map((item) => (
                        <SaveErrorField names={["compare-decision","value","item.value","decision"]} key={item.value}><Radio key={item.value} name="compare-decision" value={item.value} checked={decision === item.value} onChange={() => setDecision(item.value)}>
                          {item.label}
                        </Radio></SaveErrorField>
                      ))}
                    </div>
{decision === 'linked' ? (
                      <>
                        {/* 選ぶ欄として▽を出す（絵 fcg2D）。友だちの結び付けで選べる過去の扱いは1つだけ。 */}
                        <Select aria-label="過去の扱い" size="full" value="merge" onChange={() => undefined}
                          options={[{ value: 'merge', label: '過去の扱い：これまでの履歴を1人分にまとめる' }]} />
                        {/* 採用する値は表の「使う値」の要約。A・B どちらかにまとめて切り替えることもできる。 */}
                        <Select aria-label="採用する値" size="full" disabled={!detail.canDecide}
                          value="table"
                          onChange={(value) => {
                            if (value !== 'A' && value !== 'B') return
                            const id = value === 'A' ? detail.left.id : detail.right.id
                            setSelections((current) => ({ ...current, ...Object.fromEntries(profileCandidates.flatMap((field) => field.options.some((option) => option.sourceFriendId === id) ? [[field.fieldKey, id]] : [])) }))
                          }}
                          options={[
                            { value: 'table', label: selectionSummary },
                            { value: 'A', label: `採用する値：すべて A（${detail.left.label}）` },
                            { value: 'B', label: `採用する値：すべて B（${detail.right.label}）` },
                          ]} />
                        <div className={styles.checks}>
                          {CONSENTS.map((label, index) => (
                            <SaveErrorField names={["consents"]} key={label}><Checkbox
                              key={label}
                              checked={consents[index]}
                              onCheckedChange={(checked) => setConsents((current) => current.map((value, itemIndex) => (itemIndex === index ? checked : value)))}
                            >
                              {label}
                            </Checkbox></SaveErrorField>
                          ))}
                        </div>
                      </>
                    ) : null}
<Field label="判定の理由" htmlFor="compare-reason" required><SaveErrorField names={["reason"]}><TextField
                      id="compare-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder={decisive ? `${decisive.label}` : '何を見てそう判断したか'}
                    /></SaveErrorField></Field>
{review.decideError ? <Notice tone="danger" >{review.decideError}</Notice> : null}
{!ready && reason.trim() !== '' && decision === 'linked' && !linkedReady ? (
                      <p className={styles.note} role="status">3つの確認をそろえると判定できます。</p>
                    ) : null}
<div className={styles.panelActions}>
                      <Button type="button" variant="secondary" onClick={() => setPanelOpen(false)} disabled={review.deciding}>キャンセル</Button>
                      <Button type="button" variant="primary" onClick={submit} disabled={!ready} disabledReason={!detail.canDecide ? 'この候補は今は判定できません' : !reason.trim() ? '判定の理由を入れてください' : !linkedReady ? '使う値と3つの確認を選んでください' : undefined} busy={review.deciding} busyLabel="処理中…">判定する</Button>
                    </div></div>,
                  <div key="history" className={styles.historyCard}>
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
                  </div>,
                ]}</DashboardColumns>
              ) : null}

              <DataTable>
                <colgroup>
                  <col className={styles.colItem} />
                  <col />
                  <col />
                  <col className={styles.colUse} />
                </colgroup>
                <thead>
                  <TableHeadRow presentation="embedded">
                    <Th>項目</Th>
                    <Th>候補A</Th>
                    <Th>候補B</Th>
                    <Th>使う値</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {profileCandidates.map((field) => {
                    const left = field.options.find((option) => option.sourceFriendId === detail.left.id)
                    const right = field.options.find((option) => option.sourceFriendId === detail.right.id)
                    const same = left?.valuePreview != null && left.valuePreview === right?.valuePreview
                    return (
                      <Tr key={field.fieldKey} className={styles.row}>
                        <Td><span className={styles.itemName}>{field.fieldLabel === 'メールアドレス' ? 'メール' : field.fieldLabel}</span></Td>
                        <Td>{left?.valuePreview ?? emptyValue('unknown')}</Td>
                        <Td>{right?.valuePreview ?? emptyValue('unknown')}</Td>
                        <Td>
                          <SaveErrorField names={["selections"]}><Select
                            aria-label={`${field.fieldLabel}に使う値`}
                            size="full"
                            value={selections[field.fieldKey] ?? ''}
                            disabled={!detail.canDecide}
                            onChange={(value) => setSelections((current) => ({ ...current, [field.fieldKey]: value }))}
                            options={field.options.map((option, index) => ({
                              value: option.sourceFriendId,
                              label: same && index === 0 ? '同じ' : `${sideLetter(option.sourceFriendId) || option.sourceLabel}：${option.valuePreview ?? emptyValue('unconfigured')}`,
                            }))}
                          /></SaveErrorField>
                        </Td>
                      </Tr>
                    )
                  })}
                  {tagCandidates.length > 0 ? (
                    <Tr className={styles.rowPlain}>
                      <Td><span className={styles.itemName}>タグ</span></Td>
                      <Td>{tagCandidates.filter((tag) => tag.sourceFriendIds.includes(detail.left.id)).map((tag) => tag.name).join('・') || emptyValue('unknown')}</Td>
                      <Td>{tagCandidates.filter((tag) => tag.sourceFriendIds.includes(detail.right.id) && !tag.sourceFriendIds.includes(detail.left.id)).map((tag) => tag.name).join('・') || emptyValue('unknown')}</Td>
                      <Td><span className={styles.faint}>元の友だちに残す</span></Td>
                    </Tr>
                  ) : null}
                </tbody>
              </DataTable>
            </section>

            <StickyBar
              destructive={(
                <Button type="button" variant="secondary" disabled={!detail.canDecide || review.deciding} onClick={() => openPanel('different')}>
                  <UserX size={14} aria-hidden="true" />
                  別の人だった
                </Button>
              )}
              actions={(
                <>
                  <Button type="button" variant="secondary" disabled={!detail.canDecide || review.deciding} onClick={() => openPanel('deferred')}>
                    <Clock size={14} aria-hidden="true" />
                    あとで決める（保留）
                  </Button>
                  <Button type="button" variant="primary" disabled={!detail.canDecide || review.deciding} onClick={() => openPanel('linked')}>
                    <LinkIcon size={14} aria-hidden="true" />
                    同じ人として結び付ける
                  </Button>
                </>
              )}
            />
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
