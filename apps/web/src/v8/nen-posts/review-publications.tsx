'use client'

import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Chip from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { emptyValue } from '@/components/shared/empty-value'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { photoPetDisplayName } from '@/components/shared/photo-display-name'
import { RowActions } from '@/components/shared/row-actions'
import { SaveErrorField,SaveErrorScope,useSaveFormErrors } from '@/components/shared/save-form-errors'
import StatusBadge from '@/components/shared/status-badge'
import { ActionCell,DataTable,TableHeadRow,Td,Th,Tr } from '@/components/shared/table'
import { notifySaved,notifyToast } from '@/components/shared/toast'
import { DetailColumns } from '@/components/templates/detail-columns'
import { ApiError,api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useCallback,useEffect,useRef,useState } from 'react'
import { photoNoticeFor } from './notice'
import { PublicationRules } from './review-summary'
import styles from './review.module.css'
import { safePhotoSrc } from './src'
import { text } from './text'
import { formatPhotoReceivedAt } from './time'

export type PublicationItem = Record<string, unknown> & { placements?: Array<Record<string, unknown>> }

export function placementLabels(item: PublicationItem): string {
  const placements = Array.isArray(item.placements) ? item.placements : []
  const active = placements.filter((p) => Number(p.active ?? 1) === 1)
  if (active.length === 0) return 'どこにも出していません'
  return active.map((p) => text(p.placement_label) || text(p.placement_type)).join('・')
}

export function viewsText(value: unknown): string {
  return value == null ? emptyValue('unknown') : `${formatNumber(Number(value))}`
}

/**
 * 公式サイト掲載（SyQA1）。列：写真・ペット・どこで使っているか・
 * 過去30日に見た・公開の同意・掲載先から外す。右に出すときの決めごと。
 * 30日集計は日別の記録から表示し、記録がなければ「—」。掲載先の編集・撤回の整理・外した履歴を保つ。
 */
export function PublicationsV8({
  accountId,
  canEdit,
  publishedCount,
  onChanged,
}: {
  accountId: string
  canEdit: boolean
  publishedCount: number | null
  onChanged: () => void
}) {
  const saveErrors = useSaveFormErrors()

  const [rulesOpen, setRulesOpen] = useState(false)
  const [withdrawTarget, setWithdrawTarget] = useState<PublicationItem | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading')
  const [items, setItems] = useState<PublicationItem[]>([])
  const [orderItems, setOrderItems] = useState<PublicationItem[] | null>(null)
  const [topPhotoId, setTopPhotoId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [pendingWithdrawals, setPendingWithdrawals] = useState<PublicationItem[]>([])
  const [withdrawnItems, setWithdrawnItems] = useState<PublicationItem[]>([])
  const [editing, setEditing] = useState<PublicationItem | null>(null)
  const [selectedPlacements, setSelectedPlacements] = useState<string[]>([])
  const generation = useRef(0)
  const loadSequence = useRef(0)
  const placementChoices = [{ type: 'site', label: 'サイト' }, { type: 'column', label: 'NENコラム' }, { type: 'rich_menu', label: 'リッチメニュー' }, { type: 'form', label: '回答フォーム' }] as const
  const openPlacements = (item: PublicationItem) => {
    setEditing(item); setNotice('')
    setSelectedPlacements((item.placements ?? []).filter((placement) => Number(placement.active ?? 1) === 1).map((placement) => text(placement.placement_type)))
  }
  const savePlacements = async () => {
    if (!editing || !canEdit || busyId) return
    const accountGeneration = generation.current
    setBusyId(text(editing.id)); setNotice('')
    try {
      const response = await api.nenMembers.updatePhotoPublicationPlacements(text(editing.id), {
        accountId, expectedVersion: Number(editing.version), placements: placementChoices.filter((choice) => selectedPlacements.includes(choice.type)),
      }, crypto.randomUUID())
      if (accountGeneration !== generation.current) return
      if (!response.success) throw new Error(response.error)
      setEditing(null); await load(); onChanged()
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure);
 if (accountGeneration === generation.current) { if (!fieldFailure) setNotice('使う場所を保存できませんでした。最新の状態を読み直してください。') } }
    finally { if (accountGeneration === generation.current) setBusyId('') }
  }


  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setState('loading')
    try {
      const response = await api.nenMembers.photoPublications(accountId)
      if (sequence !== loadSequence.current) return
      if (!response.success) throw new Error(response.error)
      if (Array.isArray(response.data)) {
        setItems([])
        setTopPhotoId(null)
      } else {
        setItems(response.data.items ?? [])
        setPendingWithdrawals(response.data.pendingWithdrawals ?? [])
        setWithdrawnItems(response.data.withdrawnItems ?? [])
        setTopPhotoId(response.data.summary.topPhoto30Days ? text(response.data.summary.topPhoto30Days.id) : null)
      }
      setState('ready')
    } catch (error) {
      if (sequence !== loadSequence.current) return
      const fieldFailure = saveErrors.capture(error)
      setItems([])
      { if (!fieldFailure)
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }
  }, [accountId, saveErrors])

  useEffect(() => { void load(); return () => { generation.current += 1; loadSequence.current += 1 } }, [load])

  const withdraw = async (item: PublicationItem) => {
    if (!canEdit || busyId) return
    const accountGeneration = generation.current
    setBusyId(text(item.id))
    setNotice('')
    try {
      const response = await api.nenMembers.withdrawPhotoPublication(text(item.id), {
        accountId, expectedVersion: Number(item.version),
      }, crypto.randomUUID())
      if (accountGeneration !== generation.current) return
      if (!response.success) throw new Error(response.error)
      setWithdrawTarget(null)
      notifyToast('写真をすべての掲載先から外しました。審査と同意の履歴、付与済みのマイルは残ります。')
      await load()
      onChanged()
    } catch (error) {
      const fieldFailure = saveErrors.capture(error)

      { if (!fieldFailure)
      setNotice(error instanceof ApiError && error.status === 409
        ? '別の人が先に掲載状態を変更しました。最新の状態を読み直してください。'
        : '写真を掲載先から外せませんでした。') }
    } finally { setBusyId('') }
  }

  const openOrder = async () => {
    if (!canEdit || busyId) return
    const token = generation.current
    setBusyId('order-load')
    try {
      const response = await api.nenMembers.photoPublicationOrder(accountId)
      if (token !== generation.current) return
      if (!response.success) throw new Error(response.error)
      setOrderItems(response.data.items)
    } catch (error) {
      const fieldFailure = saveErrors.capture(error);
 if (token === generation.current) { if (!fieldFailure) setNotice(photoNoticeFor(error, '掲載順を読み込めませんでした。')) } }
    finally { if (token === generation.current) setBusyId('') }
  }
  const moveOrder = (index: number, delta: number) => {
    setOrderItems((current) => {
      if (!current || index+delta < 0 || index+delta >= current.length) return current
      const copy = [...current]; [copy[index], copy[index+delta]] = [copy[index+delta], copy[index]]
      return copy
    })
  }
  const saveOrder = async () => {
    if (!orderItems || busyId) return
    const token = generation.current
    setBusyId('order')
    setNotice('')
    try {
      const response = await api.nenMembers.savePhotoPublicationOrder({ accountId, items: orderItems.map(item => ({ id: text(item.id), expectedVersion: Number(item.version) })) })
      if (token !== generation.current) return
      if (!response.success) throw new Error(response.error)
      setOrderItems(null)
      setBusyId('')
      notifySaved('掲載順を保存しました。')
      await load()
      onChanged()
    } catch (error) {
      const fieldFailure = saveErrors.capture(error);

      if (token === generation.current) { if (!fieldFailure) setNotice(error instanceof ApiError && error.status === 409
        ? '掲載の集合か版が変わりました。キャンセルして最新の全件を読み直してください。'
        : '掲載順を保存できませんでした。') }
    } finally { if (busyId === 'order' || token === generation.current) setBusyId('') }
  }

  return (
    <SaveErrorScope errors={saveErrors}><>
      <ConfirmDialog open={withdrawTarget !== null} title="この写真を掲載先から外しますか？"
        description="すべての掲載先から外します。審査と公開同意の履歴、付与済みのマイルは残ります。"
        confirmLabel="掲載先から外す" busy={Boolean(busyId)} error={notice || undefined}
        onCancel={() => { if (!busyId) { setWithdrawTarget(null); setNotice('') } }}
        onConfirm={() => { if (withdrawTarget) void withdraw(withdrawTarget) }} />
      <Dialog open={orderItems !== null} title="掲載順を変える" description="上から順に公式サイトへ表示します。全件と確認した版をまとめて保存します。"
        confirmLabel="並び順を保存する" error={notice} busy={busyId === 'order'} onConfirm={() => saveOrder()}
        onCancel={() => { if (!busyId) { setOrderItems(null); void load() } }}>
        <ol>{orderItems?.map((item, index) => <li key={text(item.id)} className={styles.orderRow}>
          <span className={styles.orderName}>{index+1}・{photoPetDisplayName(item.pet_name, { honorific: false })}</span>
          <span className={styles.orderButtons}><Button disabled={index === 0 || Boolean(busyId)} title={busyId ? '処理が終わるまでお待ちください' : index === 0 ? 'これより上には移動できません' : undefined} aria-label={`${text(item.pet_name)}を上へ`} onClick={() => moveOrder(index,-1)}>上へ</Button>
          <Button disabled={index === orderItems.length-1 || Boolean(busyId)} title={busyId ? '処理が終わるまでお待ちください' : index === orderItems.length-1 ? 'これより下には移動できません' : undefined} aria-label={`${text(item.pet_name)}を下へ`} onClick={() => moveOrder(index,1)}>下へ</Button></span>
        </li>)}</ol>
      </Dialog>
      {notice && !withdrawTarget && !editing && !orderItems ? <Notice tone="danger" message={notice} /> : null}
      {state === 'loading' ? (
        <ListState kind="loading" title="公式サイト掲載中の写真を読み込んでいます" />
      ) : state === 'forbidden' ? (
        <ListState kind="forbidden" />
      ) : state === 'error' ? (
        <ListState kind="error" title="公式サイト掲載中の写真を読み込めませんでした" onRetry={() => void load()} />
      ) : items.length === 0 && pendingWithdrawals.length === 0 && withdrawnItems.length === 0 ? (
        <ListState kind="empty" emptyPreset="readonly" title="公式サイト掲載中の写真はありません" description="同意のある写真を掲載すると、使っている場所と表示回数がここに出ます。" />
      ) : (
        <DetailColumns presentation="card" asideLabel="出すときの決めごと" expanded={rulesOpen} onExpandedChange={setRulesOpen}
          aside={<PublicationRules canEdit={canEdit} busy={Boolean(busyId)} onOrder={() => void openOrder()} />}>
          <section data-design-node="photo-pubs-table-v8">
            <div className={styles.tableWrap}>
              <DataTable columnSizing="content" columnLayout={{ headHeight: 'var(--polish-table-head)', rowHeight: 'var(--polish-table-row)', gap: 'var(--polish-space-field)', padding: '0 var(--polish-space-card)', collapseScope: 'page' }}>
                <thead>
                  <TableHeadRow data-table-layout="columns">
                    <Th>写真</Th>
                    <Th grow>ペット</Th>
                    <Th help="この写真を使っている掲載先です。複数の場所は行にまとめて表示します。">掲載先</Th>
                    <Th align="right"><span title="30日間の集計は未接続です。累計の回数には置き換えません">過去30日に見た</span></Th>
                    <Th>公開の同意</Th>
                    <Th align="right">操作</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const imageSrc = safePhotoSrc(item.image_url)
                    const name = photoPetDisplayName(item.pet_name, { fallback: 'ペット名未取得', honorific: false })
                    const consented = Boolean(text(item.publication_consent_at)) && !text(item.publication_withdrawn_at)
                    return (
                      <Tr key={text(item.id)} data-table-layout="columns">
                        <Td>
                          {imageSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element -- 掲載中の公開写真
                            <img src={imageSrc} alt={`${name}の公開写真`} loading="lazy" className={styles.pubThumb} />
                          ) : (
                            <span aria-hidden="true" className={styles.pubThumb} />
                          )}
                        </Td>
                        <Td grow>
                          <span className={styles.pubNameRow}>
                            <span className={styles.petNameV8}>{name}</span>
                            {topPhotoId === text(item.id) ? <Chip tone="info">いちばん見られた</Chip> : null}
                          </span>
                          <span className={styles.petSubV8}>{Number(item.hide_owner_name) === 0 ? '名前を出しています' : '名前は伏せています'}</span>
                        </Td>
                        <Td><span className={styles.pubCell} title={placementLabels(item)}>{placementLabels(item)}</span></Td>
                        <Td align="right" data-list-number>{viewsText(item.view_count_30_days)}</Td>
                        <Td><StatusBadge tone={consented ? 'success' : 'neutral'} size="compact">{consented ? '同意あり' : '未取得'}</StatusBadge></Td>
                        <ActionCell>
                          {canEdit ? <RowActions subjectName={name}
                            detail={{ label: busyId === text(item.id) ? '外しています...' : '掲載先から外す', disabled: busyId === text(item.id), onClick: () => { setNotice(''); setWithdrawTarget(item) } }}
                            menuItems={[{ id: 'placements', label: '使う場所', onSelect: () => openPlacements(item) }]} /> : null}
                        </ActionCell>
                      </Tr>
                    )
                  })}
                </tbody>
              </DataTable>
            </div>
            <p className={styles.listHint}>{`公式サイト掲載中 ${publishedCount ?? emptyValue('unknown')}枚のうち ${items.length}枚を表示（使っている場所で絞る：サイト・NENコラム・リッチメニュー・回答フォーム・登録メディア）`}</p>
            <details className={styles.publicationHistory}><summary>掲載の整理と外した履歴（{pendingWithdrawals.length + withdrawnItems.length}件）</summary>
              {pendingWithdrawals.map((item) => <div key={text(item.id)}><strong>{text(item.pet_name) || '写真'}</strong><p>{text(item.publication_withdrawn_at) ? 'ご本人が公開の同意を撤回しました' : '公開の同意と採用状態を確認してください'}</p><p>まだ残っている掲載先：{placementLabels(item)}</p>{canEdit ? <Button variant="secondary" disabled={Boolean(busyId)} onClick={() => { setNotice(''); setWithdrawTarget(item) }} busy={Boolean(busyId)} busyLabel="処理中…">掲載先から外す</Button> : null}</div>)}
              {withdrawnItems.map((item) => <div key={text(item.id)}><strong>{text(item.pet_name) || '写真'}</strong><p>外した日時：{formatPhotoReceivedAt(item.withdrawn_at)}・{text(item.withdrawn_by_name) || '—'}</p>{(item.placements ?? []).map((placement) => <p key={text(placement.id)}>{text(placement.placement_label)}・{text(placement.removed_at) ? `${formatPhotoReceivedAt(placement.removed_at)}に外しました` : '記録あり'}</p>)}</div>)}
            </details>
          </section>
        </DetailColumns>
      )}
      <Dialog open={Boolean(editing)} title="使う場所" description="同意のある写真の掲載先を選びます。原本は公開しません。" busy={Boolean(busyId)} error={notice} confirmLabel="保存する" onCancel={() => { if (!busyId) setEditing(null) }} onConfirm={() => savePlacements()}>
        {placementChoices.map((choice, saveFieldIndex) => <SaveErrorField names={[`placementChoices.${saveFieldIndex}.type`,"type","choice.type","selectedPlacements","selected_placements"]} key={choice.type}><Checkbox key={choice.type} checked={selectedPlacements.includes(choice.type)} onCheckedChange={(checked) => setSelectedPlacements((current) => checked ? [...current, choice.type] : current.filter((type) => type !== choice.type))}>{choice.label}</Checkbox></SaveErrorField>)}
      </Dialog>
    </></SaveErrorScope>
  )
}
