'use client'

/*
 * ★V8 タグを作る・編集（Pencil `d9xoI` 作る / `Qat9s` 編集）。
 *
 * v7（components/friend-fields/tag-editor-v4.tsx）と動きは同じで、
 * 置き場だけを V8 の絵へ合わせる。段は「基本」「付け方」（作る）・
 * 「タグ連動」「マイル」。編集は右の欄に「使っている所」と、
 * 消したときの注意を出す。下の帯（StickyBar）は削除＝左端、
 * キャンセル・複製・保存＝真ん中（オーナー決定 2026-10-01）。
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Copy, Trash2 } from 'lucide-react'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, type CommonActionResources, type TagRetroactivePreview } from '@/lib/api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import TagPill from '@/components/shared/tag-pill'
import Checkbox from '@/components/shared/checkbox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { notifyToast } from '@/components/shared/toast'
import StickyBar from '@/components/shared/sticky-bar'
import { RequiredBadge } from '@/components/shared/form-controls'
import { AttributeKindGuide, DuplicateNameNote, findDuplicateNames } from '@/components/friend-fields/attribute-kind-guide'
import {
  ActionDrawer,
  RetroactiveDialog,
  type LinkedAction,
  type TagEditorActionLabel,
  type TagEditorInitialValues,
  type TagEditorValues,
} from '@/components/friend-fields/tag-editor-v4'
import styles from './tag-editor-v8.module.css'

/** 連動 OFF のときに出す「ON にすると何ができるか」（v7 と同じ内容）。 */
const LINKED_PREVIEW = [
  { label: '本人へのマイル付与', note: 'このタグが初めて付いた本人に +N mile' },
  { label: '紹介者へのマイル付与', note: '紹介した人に +N mile' },
  { label: '今後のマイル倍率', note: 'このタグを持つ間、獲得マイルを 1.2／1.5／2.0／3.0倍' },
  { label: '連動アクション', note: 'テキスト送信・テンプレート送信・タグ操作・シナリオ開始など' },
]

const MULTIPLIERS = [
  { value: '', label: '倍率を設定しない' },
  { value: '12000', label: '1.2倍' },
  { value: '15000', label: '1.5倍' },
  { value: '20000', label: '2.0倍' },
  { value: '30000', label: '3.0倍' },
]

/** 「付け方」段の説明の箱 3 つ（どこでタグが付くか）。 */
const ATTACH_WAYS = [
  { title: '手動で付ける', body: '友だち一覧やチャットから手で付けます。' },
  { title: '回答フォームで付ける', body: 'フォームの回答をきっかけに自動で付きます。', href: '/form-submissions', hrefLabel: '回答フォーム' },
  { title: 'オートメーションで付ける', body: '条件に合ったとき自動で付きます。', href: '/automations', hrefLabel: 'オートメーション' },
]

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
    >
      <span className={styles.toggleKnob} />
    </button>
  )
}

function SectionTitle({ title, note, side }: { title: string; note?: string; side?: React.ReactNode }) {
  return (
    <div className={styles.sectionHead}>
      <div>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {note ? <p className={styles.sectionDesc}>{note}</p> : null}
      </div>
      {side}
    </div>
  )
}

export default function TagEditorV8({
  mode,
  groups,
  tag,
  accountId = null,
  initialLinked = false,
  initialDrawerOpen = false,
  initialApplyToExisting = false,
  initialRetroactiveOpen = false,
  initialValues,
  referenceDrawerState = false,
  referenceRetroactiveState = false,
  saving,
  error,
  notice,
  foldersFailed = false,
  onRetryFolders,
  onCancel,
  onSave,
  onDelete,
  readOnly = false,
  embedded = false,
  resources,
  allowedActionTypes,
}: {
  mode: 'create' | 'edit'
  groups: TagGroup[]
  tag?: Tag | null
  accountId?: string | null
  initialLinked?: boolean
  initialDrawerOpen?: boolean
  initialApplyToExisting?: boolean
  initialRetroactiveOpen?: boolean
  initialValues?: TagEditorInitialValues
  referenceDrawerState?: boolean
  referenceRetroactiveState?: boolean
  saving: boolean
  error?: string
  notice?: string
  foldersFailed?: boolean
  onRetryFolders?: () => void
  onCancel: () => void
  onSave: (values: TagEditorValues, andAnother: boolean, applyRetroactive: boolean, previewToken?: string) => Promise<void>
  onDelete?: () => void
  /*
   * 閲覧のみ（`fkGUR`）。中身の入力・仕掛けは fieldset で一括して
   * 押せなくし、リンク型のボタンだけ取り替える（fieldset は
   * リンクを止められないため）。見た目は変えない。
   */
  readOnly?: boolean
  embedded?: boolean
  resources?: CommonActionResources | null
  allowedActionTypes?: readonly TagEditorActionLabel[]
}) {
  usePageTitle(mode === 'create' ? 'タグを作る' : 'タグを編集')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '友だち属性', href: '/tags' }])
  // 親から渡る保存の知らせは、画面の中の文で出さず Toast（右下・4秒）へ送る。
  useEffect(() => {
    if (notice) notifyToast(notice)
  }, [notice])
  const [name, setName] = useState(initialValues?.name ?? tag?.name ?? '')
  const [groupId, setGroupId] = useState(initialValues?.groupId ?? tag?.groupId ?? '')
  const [isStarred, setIsStarred] = useState(initialValues?.isStarred ?? tag?.isStarred ?? false)
  const hasStoredLink = Boolean((tag?.mileageReward ?? 0) || (tag?.referralMileageReward ?? 0) || tag?.mileageMultiplierBps)
  const [linked, setLinked] = useState((initialValues?.linked ?? initialLinked) || hasStoredLink)
  const [reward, setReward] = useState(String(initialValues?.rewardMiles ?? tag?.mileageReward ?? 0))
  const [referralReward, setReferralReward] = useState(String(initialValues?.referralRewardMiles ?? tag?.referralMileageReward ?? 0))
  const initialMultiplier = initialValues?.multiplierBps ?? tag?.mileageMultiplierBps
  const [multiplier, setMultiplier] = useState(initialMultiplier == null ? '' : String(initialMultiplier))
  const [priority, setPriority] = useState(String(initialValues?.multiplierPriority ?? tag?.mileageMultiplierPriority ?? 0))
  const [applyToExisting, setApplyToExisting] = useState(initialValues?.applyToExisting ?? initialApplyToExisting)
  const [reapplyMode, setReapplyMode] = useState<'once' | 'every'>((initialValues?.reapplyPolicy ?? tag?.reapplyPolicy) === 'every_time' ? 'every' : 'once')
  const [actions, setActions] = useState<LinkedAction[]>(initialValues?.actions ?? tag?.linkedActions ?? [])
  const [drawerOpen, setDrawerOpen] = useState(initialDrawerOpen)
  const [retroactiveOpen, setRetroactiveOpen] = useState(initialRetroactiveOpen)

  /* IDEA-04: 同名のタグがすでにあるとき、保存する前に知らせる。 */
  const [siblingNames, setSiblingNames] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    if (embedded || !accountId) return
    let cancelled = false
    void api.tags.list({ accountId })
      .then((res) => { if (!cancelled && res.success) setSiblingNames(res.data.map((item) => ({ id: item.id, name: item.name }))) })
      .catch(() => { /* 注意が出せないだけ。読み直しはしない */ })
    return () => { cancelled = true }
  }, [accountId, embedded])
  const nameDuplicates = useMemo(
    () => findDuplicateNames(siblingNames, name, tag?.id ?? null),
    [siblingNames, name, tag?.id],
  )

  const previewColor = groups.find((group) => group.id === groupId)?.color ?? 'var(--color-accent)'
  const groupName = groups.find((group) => group.id === groupId)?.name ?? '未分類'
  const values = useMemo<TagEditorValues>(() => ({
    name: name.trim(), groupId, isStarred, linked,
    rewardMiles: linked ? Number(reward) || 0 : 0,
    referralRewardMiles: linked ? Number(referralReward) || 0 : 0,
    multiplierBps: linked && multiplier ? Number(multiplier) : null,
    multiplierPriority: linked ? Number(priority) || 0 : 0,
    applyToExisting,
    reapplyPolicy: reapplyMode === 'every' ? 'every_time' : 'first_only',
    actions: linked ? actions : [],
  }), [name, groupId, isStarred, linked, reward, referralReward, multiplier, priority, applyToExisting, reapplyMode, actions])

  /*
   * N-047: 「いま付いている人への反映」の人数はサーバー側の事前計算で
   * 出す。入力中のマイルで debounce しつつ数え直す。失敗しても保存は
   * 止めない——実行前の確認窓で必ずもう一度計算する。
   */
  const [retroPreview, setRetroPreview] = useState<TagRetroactivePreview | null>(null)
  useEffect(() => {
    if (referenceRetroactiveState) return
    if (mode !== 'edit' || !tag?.id || !accountId) { setRetroPreview(null); return }
    const timer = setTimeout(() => {
      void api.tags.retroactivePreview(tag.id, accountId, {
        self: values.rewardMiles,
        referrer: values.referralRewardMiles,
      }).then((res) => { if (res.success) setRetroPreview(res.data) }).catch(() => {})
    }, 400)
    return () => clearTimeout(timer)
  }, [mode, tag?.id, accountId, values.rewardMiles, values.referralRewardMiles, referenceRetroactiveState])

  const requestSave = (andAnother: boolean) => {
    if (mode === 'edit' && applyToExisting && (tag?.friendCount ?? 0) > 0 && (values.rewardMiles > 0 || values.referralRewardMiles > 0)) {
      setRetroactiveOpen(true)
      return
    }
    void onSave(values, andAnother, false)
  }

  const duplicateAction = (action: LinkedAction, index: number) => {
    const id = crypto.randomUUID()
    const copy = { ...action, id, definition: action.definition ? { ...action.definition, id } : undefined }
    setActions((current) => [
      ...current.slice(0, index + 1),
      copy,
      ...current.slice(index + 1),
    ])
  }

  /* #670 28: ドラッグはマウス専用。キーボードだけでも「上へ」「下へ」で動かせる。 */
  const moveAction = (index: number, direction: -1 | 1) => {
    setActions((current) => {
      const next = index + direction
      if (next < 0 || next >= current.length) return current
      const reordered = [...current]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(next, 0, moved)
      return reordered
    })
  }
  const removeAction = (id: string) => {
    setActions((current) => current.filter((item) => item.id !== id))
  }
  const [dragActionId, setDragActionId] = useState<string | null>(null)

  const usedIn = tag?.usedIn
  const usageRows = [
    { name: '配信', count: usedIn?.broadcasts },
    { name: 'フォーム', count: usedIn?.forms },
    { name: 'シナリオ', count: usedIn?.scenarios },
    { name: '自動応答', count: usedIn?.autoReplies },
    { name: '保存した検索', count: usedIn?.savedSearches },
    { name: 'タグ連動', count: tag?.otherActionCount ?? actions.length },
  ]

  return (
    <div className={styles.board}>
      {!embedded && (
        <div className={styles.head} data-design="Head">
          <div>
            <h2 className={styles.headTitle}>{mode === 'create' ? 'タグを作る' : 'タグを編集'}</h2>
            <p className={styles.headDescription}>
              {mode === 'create' ? '名前・フォルダ・付け方・連動を決めて保存します。' : '名前・フォルダ・連動・マイルの設定を変えられます。'}
            </p>
          </div>
        </div>
      )}

      {error && <Notice tone="danger" message={error} />}

      {/*
       * 閲覧のみは入力欄も仕掛けの押し口も押せない形にする。
       * 枠の見た目は消してある（中身の CSS はそのまま）。
       */}
      <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <div className={styles.split} data-design="Body">
        <div className={styles.main} data-design="Left">
          {/* 段：基本 */}
          <section className={styles.section}>
            <SectionTitle title="基本" />
            <div className={styles.sectionBody}>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>所属フォルダ</span>
                  <Select
                    aria-label="所属フォルダ"
                    value={groupId}
                    onChange={setGroupId}
                    options={[{ value: '', label: '未分類' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]}
                    size="full"
                  />
                  <span className={styles.fieldHint}>フォルダの色がタグの印になります。未選択なら「未分類」です。</span>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>タグ名 <RequiredBadge /></span>
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例: 定期購入者" className={styles.input} />
                  <DuplicateNameNote duplicates={nameDuplicates} kindLabel="タグ" />
                </label>
              </div>
              {foldersFailed ? (
                <div className={styles.noteBand} role="alert">
                  フォルダを読み込めませんでした。未分類で作るか、読み直してください。
                  {onRetryFolders ? <Button type="button" onClick={onRetryFolders}>フォルダを読み直す</Button> : null}
                </div>
              ) : null}
              <AttributeKindGuide current="tag" />
              <Checkbox checked={isStarred} onCheckedChange={setIsStarred} description="このスイッチ、またはタグ一覧の星をクリックして、友だち一覧への表示をON／OFFできます。">友だち一覧に表示する（★）</Checkbox>
            </div>
          </section>

          {/* 段：付け方（作る画面だけの説明の箱 3 つ） */}
          {mode === 'create' && (
            <section className={styles.section}>
              <SectionTitle title="付け方" note="タグはいくつかの場所から付けられます。ここでは手動と連動を決められます。" />
              <div className={styles.sectionBody}>
                <div className={styles.wayGrid}>
                  {ATTACH_WAYS.map((way) => (
                    <div key={way.title} className={styles.wayBox}>
                      <h3 className={styles.wayTitle}>{way.title}</h3>
                      <p className={styles.wayDesc}>
                        {way.body}
                        {'href' in way && way.href ? (
                          <> <Link href={way.href} className="text-action underline">{way.hrefLabel}</Link> から設定します。</>
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* 段：タグ連動 */}
          <section className={styles.section}>
            <SectionTitle
              title="タグ連動"
              note="このタグが付いた瞬間に動かす処理をまとめて決めます。"
              side={(
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`${styles.toggleState} ${linked ? styles.toggleStateOn : styles.toggleStateOff}`}>{linked ? 'ON' : 'OFF'}</span>
                  <Toggle checked={linked} onChange={setLinked} label="タグ連動" />
                </div>
              )}
            />
            <div className={styles.sectionBody}>
              {!linked ? (
                <div className={styles.wayBox}>
                  <p className={styles.wayTitle}>ONにすると、ここで次の設定ができます</p>
                  <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {LINKED_PREVIEW.map((item) => (
                      <li key={item.label} style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-ink-faint)' }}>
                        ● <span style={{ fontWeight: 600, color: 'var(--color-ink-secondary)' }}>{item.label}</span>　{item.note}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <p className={styles.noteText}>上から順に実行されます。つまんで動かすか、↑↓で順番を変更できます。</p>
                    <Button type="button" variant="secondary" onClick={() => setDrawerOpen(true)}>＋ アクションを追加する</Button>
                  </div>
                  {actions.length === 0 ? (
                    <p className={styles.emptyBox}>連動アクションはまだありません</p>
                  ) : (
                    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {actions.map((action, index) => (
                          <li
                            key={action.id}
                            draggable
                            onDragStart={() => setDragActionId(action.id)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => {
                              const fromId = dragActionId
                              setDragActionId(null)
                              if (!fromId || fromId === action.id) return
                              setActions((current) => {
                                const from = current.findIndex((item) => item.id === fromId)
                                if (from < 0) return current
                                const reordered = current.filter((item) => item.id !== fromId)
                                reordered.splice(Math.min(index, reordered.length), 0, current[from])
                                return reordered
                              })
                            }}
                            onDragEnd={() => setDragActionId(null)}
                            className={`${styles.actionRow} ${dragActionId === action.id ? styles.actionRowDragging : ''}`}
                          >
                            <span className={styles.actionGrip} title="ドラッグで順番を変更">⋮⋮</span>
                            <span className={styles.actionIndex}>{index + 1}</span>
                            <span className={styles.actionType}>{action.type}</span>
                            <span className={styles.actionLabel} title={action.label}>{action.label}</span>
                            <span className={styles.actionTiming}>{action.timing}</span>
                            <span className={styles.actionIcons}>
                              <button type="button" className={styles.iconButton} aria-label={`「${action.label}」を上へ`} disabled={index === 0} onClick={() => moveAction(index, -1)}><ArrowUp size={14} /></button>
                              <button type="button" className={styles.iconButton} aria-label={`「${action.label}」を下へ`} disabled={index === actions.length - 1} onClick={() => moveAction(index, 1)}><ArrowDown size={14} /></button>
                              <button type="button" className={styles.iconButton} aria-label={`「${action.label}」を複製`} onClick={() => duplicateAction(action, index)}><Copy size={14} /></button>
                              <button type="button" className={styles.iconButton} aria-label={`「${action.label}」を削除`} onClick={() => removeAction(action.id)}><Trash2 size={14} /></button>
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              )}
              <p className={styles.noteText}>OFFのままでも、タグの手動付与・配信の絞り込み・シナリオ条件には使えます。</p>
              {mode === 'edit' && linked ? (
                <p className={styles.noteText}>OFFに戻すと、これ以降このタグが付いても連動は動きません。すでに積んだマイルは取り消されません。</p>
              ) : null}
            </div>
          </section>

          {/* 段：マイル（連動が ON のとき） */}
          {linked && (
            <section className={styles.section}>
              <SectionTitle title="マイル" note="タグが付いたときのマイル付与と、今後の獲得倍率を決めます。" />
              <div className={styles.sectionBody}>
                <div className={styles.fieldGrid2}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>本人へのマイル付与</span>
                    <span className={styles.numberRow}><input type="number" min={0} value={reward} onChange={(event) => setReward(event.target.value)} className={styles.input} /><span className={styles.unit}>mile</span></span>
                    <span className={styles.fieldHint}>このタグが付いた本人へ、一度だけ積みます。</span>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>紹介者へのマイル付与</span>
                    <span className={styles.numberRow}><input type="number" min={0} value={referralReward} onChange={(event) => setReferralReward(event.target.value)} className={styles.input} /><span className={styles.unit}>mile</span></span>
                    <span className={styles.fieldHint}>紹介経由の友だちなら、その紹介者にも積みます。</span>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>今後のマイル倍率</span>
                    <Select aria-label="今後のマイル倍率" value={multiplier} onChange={setMultiplier} options={MULTIPLIERS.map((option) => ({ value: option.value, label: option.label }))} size="full" />
                    <span className={styles.fieldHint}>このタグが付いている間、次回以降の付与倍率に使います。</span>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>倍率の優先度</span>
                    <Select aria-label="倍率の優先度" value={priority} onChange={setPriority} options={[0, 1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: value === 0 ? '標準' : `優先度 ${value}` }))} size="full" />
                    <span className={styles.fieldHint}>倍率タグが複数ある場合、数字が大きい設定を優先します。</span>
                  </label>
                </div>
                <RadioCardGroup legend="タグを外して付け直したときの扱い" legendVisible>
                  <RadioCard name="reapplyMode" value="once" checked={reapplyMode === 'once'} onChange={() => setReapplyMode('once')} title="最初の1回だけ積む" note="誤操作や付け直しで、同じマイルが重複しません。" />
                  <RadioCard name="reapplyMode" value="every" checked={reapplyMode === 'every'} onChange={() => setReapplyMode('every')} title="付け直すたびに積む" note="購入回数など、同じタグを繰り返し使う運用向けです。" />
                </RadioCardGroup>
                {mode === 'edit' && (
                  <div className={styles.sectionHead} style={{ borderTop: '1px solid var(--color-hairline)', paddingTop: 14 }}>
                    <div>
                      <h3 className={styles.sectionTitle} style={{ fontSize: 14 }}>さかのぼって反映</h3>
                      <p className={styles.sectionDesc}>既存の友だちにも、今回のマイル設定をさかのぼって反映できます。保存すると確認画面が開きます。</p>
                    </div>
                    <Toggle checked={applyToExisting} onChange={setApplyToExisting} label="さかのぼって反映" />
                  </div>
                )}
                {mode === 'edit' && applyToExisting && (
                  <div className={styles.statGrid}>
                    <div className={styles.statBox}><p className={styles.statLabel}>現在の対象者</p><p className={styles.statValue}>{tag?.friendCount ?? 0}<span className={styles.statUnit}>人</span></p></div>
                    <div className={styles.statBox}><p className={styles.statLabel}>本人マイル対象</p><p className={styles.statValue}>{retroPreview ? retroPreview.selfTargets : referenceRetroactiveState ? (tag?.friendCount ?? 0) : '—'}<span className={styles.statUnit}>人</span></p></div>
                    <div className={styles.statBox}><p className={styles.statLabel}>紹介者対象</p><p className={styles.statValue}>{retroPreview ? retroPreview.referralTargets : referenceRetroactiveState ? Math.min(tag?.friendCount ?? 0, 34) : '—'}<span className={styles.statUnit}>人</span></p></div>
                    <div className={styles.statBox}><p className={styles.statLabel}>倍率</p><p className={styles.statValue} style={{ fontSize: 14 }}>次回付与から</p></div>
                  </div>
                )}
                {mode === 'edit' && retroPreview && (retroPreview.selfExcluded > 0 || retroPreview.referralExcluded > 0) && (
                  <p className={styles.noteText}>すでに付与済みの人（本人{retroPreview.selfExcluded}人・紹介者{retroPreview.referralExcluded}人）は対象から外れています。</p>
                )}
                {mode === 'edit' && applyToExisting && (
                  <p className={styles.noteBand}>保存すると確認画面が開きます。確認を完了するまで既存の友だちへは反映されません。</p>
                )}
              </div>
            </section>
          )}
        </div>

        {/* 右の欄 */}
        <div className={styles.side} data-design="Right">
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>できあがるタグ</h2>
            <div className={styles.sectionBody}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <TagPill name={name || 'タグ名'} color={previewColor} />
                <span className={styles.previewGroup}>{groupName}</span>
              </div>
              <p className={styles.noteText}>このタグは、配信の絞り込み・シナリオの開始条件・自動応答の付与先として使えます。</p>
            </div>
          </section>

          {mode === 'edit' ? (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>使っている所</h2>
              <div className={styles.sectionBody}>
                <dl className={styles.useList}>
                  {usageRows.map((row) => (
                    <div key={row.name} className={styles.useRow}>
                      <dt className={styles.useName}>{row.name}</dt>
                      <dd className={styles.useCount}>{row.count === undefined || row.count === null ? '—' : `${row.count}件`}</dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.noteText}>削除すると、使っている設定と、いま付いている友だちの印に影響します。</p>
              </div>
            </section>
          ) : null}

          {mode === 'edit' ? (
            <section className={styles.warnCard}>
              <h2 className={styles.warnTitle}>取り消せない操作です</h2>
              <p className={styles.warnDesc}>{applyToExisting ? '遡及反映を実行すると、既存の友だちへのマイル付与やメッセージ送信は自動で取り消されません。保存後の確認画面で対象人数を確認してください。' : '保存すると、今後このタグが付いたときの動きが新しい設定へ切り替わります。既存の友だちには反映されません。'}</p>
            </section>
          ) : (
            <section className={styles.warnCard}>
              <h2 className={styles.warnTitle}>保存しただけでは、まだ誰にも届きません</h2>
              <p className={styles.warnDesc}>新規作成の保存では、既存の友だちへの送信・マイル付与は行われません。実際に動くのは、このあとタグが付いたときからです。</p>
            </section>
          )}
        </div>
      </div>

      <StickyBar
        destructive={mode === 'edit' && onDelete ? (
          <button type="button" onClick={onDelete} className={styles.dangerButton}>タグを削除する</button>
        ) : undefined}
        status={mode === 'create' ? 'まだ保存していません' : undefined}
        actions={(
          <>
            <Button onClick={onCancel}>キャンセル</Button>
            {mode === 'edit' && !embedded ? (
              // リンク型の押し口は fieldset で止められないので、閲覧のみでは押せない型に替える。
              readOnly ? (
                <Button type="button" disabled>複製して作る</Button>
              ) : (
                <Button href={`/tags/new?copy=${tag?.id ?? ''}`}>複製して作る</Button>
              )
            ) : null}
            {mode === 'create' ? <Button disabled={saving} onClick={() => requestSave(true)}>保存して続けて作る</Button> : null}
            <Button variant="primary" disabled={saving} onClick={() => requestSave(false)} busy={saving}>{mode === 'create' ? 'タグを作る' : 'タグを保存する'}</Button>
          </>
        )}
      />
      </fieldset>

      {drawerOpen && <ActionDrawer accountId={accountId} suppliedResources={resources} allowedActionTypes={allowedActionTypes} referenceState={referenceDrawerState} onClose={() => setDrawerOpen(false)} onAdd={(action) => { setActions((current) => [...current, action]); setDrawerOpen(false) }} />}
      {retroactiveOpen && <RetroactiveDialog referenceState={referenceRetroactiveState} values={values} count={tag?.friendCount ?? 0} tagId={tag?.id ?? null} accountId={accountId} onCancel={() => { setRetroactiveOpen(false); void onSave({ ...values, applyToExisting: false }, false, false) }} onSave={(previewToken) => { setRetroactiveOpen(false); void onSave(values, false, true, previewToken) }} />}
    </div>
  )
}
