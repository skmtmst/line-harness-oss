'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import Card from '@/components/shared/card'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { TextArea, TextField } from '@/components/shared/text-field'
import { HqAccountPickerField } from '@/components/shared/hq-account-picker'
import { hqTemplatesApi } from '@/lib/hq-templates-api'
import { hqDeliveriesApi, type HqDeliveryTemplate, type HqDeliveryTemplateDetail } from '@/lib/api-hq-deliveries'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import type { HqDeliveryTemplateType } from '@line-crm/shared'
import styles from './console.module.css'

const TYPES: Array<{ id: HqDeliveryTemplateType; label: string }> = [
  { id: 'auto_reply', label: '自動応答' },
  { id: 'friend_add_rule', label: '友だち追加時の配信' },
  { id: 'reminder', label: 'リマインダ' },
]
const titleOf = (type: HqDeliveryTemplateType) => TYPES.find((item) => item.id === type)?.label ?? '配信設定'
const initialSettings = (type: HqDeliveryTemplateType) => type === 'auto_reply'
  ? { name: '', keyword: '', matchType: 'contains', responseType: 'text', responseContent: '', templateId: null, activeFrom: null, activeUntil: null, cooldownMinutes: null, skipWhenOperatorActive: false, priority: 0, messageKinds: null, receiveSources: ['line'], friendConditions: null, actions: null, responseWeekdays: null, responseHolidayRule: null, oncePerFriend: false, keywords: null, respondToAll: false, keywordMatchMode: 'any', normalizeKeywords: true, internalMemo: null, replyDelaySeconds: null, unmatchedAction: null }
  : type === 'friend_add_rule'
    ? { name: '', friendKind: 'first_time', priority: 0, definition: { routeIds: [], scenarioId: null, messageType: 'text', messageText: '', timing: 'immediate', friendCondition: '', actions: [], activeFrom: null, activeUntil: null, returningMode: 'none', startPosition: 'beginning', deliveryChoices: { sendWelcomeMessage: true, startScenario: false, runActions: false }, resendSuppressionHours: null, unknownRouteAction: { sendCommonGuidance: false, notifyStaff: false } } }
    : { name: '', description: '', lineAccountId: '', triggerType: 'event', deliveryMode: 'time', triggerOffsetMinutes: null, sendAtTime: null, stopConditions: {}, steps: [] }

export default function HqDeliveryConsole({ type }: { type: HqDeliveryTemplateType }) {
  const router = useRouter()
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  const [rows, setRows] = useState<HqDeliveryTemplate[]>([])
  const [selected, setSelected] = useState<HqDeliveryTemplateDetail | null>(null)
  const [view, setView] = useState<'list' | 'edit' | 'accounts' | 'preflight' | 'result'>('list')
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [preflight, setPreflight] = useState<Awaited<ReturnType<typeof hqDeliveriesApi.preflight>> | null>(null)
  const [distributionResult, setDistributionResult] = useState<Awaited<ReturnType<typeof hqDeliveriesApi.distribute>> | null>(null)
  usePageTitle(`${titleOf(type)}を配る`)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await hqDeliveriesApi.list(type)) }
    catch { setError('ひな形を読み込めませんでした。もう一度お試しください。') }
    finally { setLoading(false) }
  }, [type])
  useEffect(() => { void load(); void hqTemplatesApi.accounts().then(setAccounts).catch(() => setAccounts([])) }, [load])

  const edit = async (row: HqDeliveryTemplate) => {
    setError(''); setNotice(''); setBusy(true)
    try { setSelected(await hqDeliveriesApi.detail(row.id)); setPreflight(null); setSelectedAccounts([]); setView('edit') }
    catch { setError('ひな形を開けませんでした。一覧を読み直してください。') }
    finally { setBusy(false) }
  }
  const create = () => {
    const settings = initialSettings(type)
    setSelected({ template: { id: '', name: '', description: null, template_type: type, revision: 0, distributed_account_names: [], distributed_account_more: 0, distributed_account_count: 0, content_summary: '' }, definition: { schemaVersion: 1, settings, references: [] } })
    setPreflight(null); setSelectedAccounts([]); setError(''); setNotice(''); setView('edit')
  }
  const settings = selected?.definition.settings as Record<string, unknown> | undefined
  const updateSetting = (key: string, value: unknown) => {
    if (!selected) return
    setSelected({ ...selected, definition: { ...selected.definition, settings: { ...selected.definition.settings, [key]: value } } })
  }
  const field = (key: string, label: string, multiline = false) => {
    const value = String(settings?.[key] ?? '')
    return <label className={styles.field} key={key}><span>{label}</span>{multiline
      ? <TextArea disabled={!canEdit} value={value} onChange={(event) => updateSetting(key, event.target.value)} rows={4} />
      : <TextField disabled={!canEdit} value={value} onChange={(event) => updateSetting(key, event.target.value)} />}</label>
  }
  const save = async () => {
    if (!selected || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const input = { name: selected.template.name.trim(), description: selected.template.description ?? undefined, definition: selected.definition }
      const result = selected.template.id
        ? await hqDeliveriesApi.update(selected.template.id, { ...input, expectedRevision: selected.template.revision })
        : await hqDeliveriesApi.create({ ...input, type, folderId: null, requestId: crypto.randomUUID() } as never)
      setSelected(result); setNotice('下書きを保存しました。配布先を選べます。'); setPreflight(null); setView('accounts'); await load()
    } catch { setError('保存できませんでした。内容を確認してもう一度お試しください。') }
    finally { setBusy(false) }
  }
  const prepare = async () => {
    if (!selected?.template.id || selectedAccounts.length === 0 || busy) return
    setBusy(true); setError('')
    try {
      const result = await hqDeliveriesApi.preflight(selected.template.id, selectedAccounts)
      setPreflight(result)
      const defaults: Record<string, string> = {}
      result.stores.forEach((store) => store.items.forEach((item) => { if (item.allowedModes.length === 1) defaults[`${store.accountId}:${item.sourceId}`] = item.allowedModes[0] }))
      setChoices(defaults)
      setView('preflight')
    } catch { setError('配る前の確認ができませんでした。選んだアカウントを確認してください。') }
    finally { setBusy(false) }
  }
  const distribute = async () => {
    if (!selected?.template.id || !preflight || busy) return
    const resolutions = preflight.stores.flatMap((store) => store.items.map((item) => ({ accountId: store.accountId, sourceId: item.sourceId, mode: choices[`${store.accountId}:${item.sourceId}`] as 'create' | 'overwrite' | 'alias' })).filter((item) => item.mode))
    if (resolutions.length !== preflight.stores.reduce((count, store) => count + store.items.length, 0)) { setError('各アカウントの配り方を選んでください。'); return }
    setBusy(true); setError('')
    try {
      const result = await hqDeliveriesApi.distribute(selected.template.id, preflight.preflightId, resolutions)
      setDistributionResult(result)
      setNotice(result.status === 'completed' ? '配布が完了しました。店には下書きとして届きました。' : result.status === 'running' ? '配布を受け付けました。状態を確認しています。' : '配布を完了できないアカウントがあります。結果を確認してください。')
      setPreflight(null); setView('result'); await load()
    } catch { setError('配布結果を確認できませんでした。配布履歴から状態を確認してください。') }
    finally { setBusy(false) }
  }

  const tabControls = useMemo(() => <>
    <Button aria-pressed={false} onClick={() => router.push('/hq/templates')}>メッセージなど</Button>
    {TYPES.map((item) => <Button key={item.id} aria-pressed={item.id === type} onClick={() => router.push(`/hq/templates?type=${item.id}`)}>{item.label}</Button>)}
  </>, [router, type])
  const boardId = view === 'list' ? 'LRc93' : view === 'edit' ? 'X4JcOf' : view === 'result' ? 'dEvJM' : 'meBRB'
  const pageTitle = view === 'list' ? '配信設定を配る' : view === 'edit' ? (selected?.template.id ? '配信設定を編集する' : '配信設定を作る') : view === 'accounts' ? 'アカウントへ配る' : view === 'preflight' ? '配る内容を確かめる' : '配布結果'
  return <PageFrame kind={view === 'list' ? 'list' : view === 'edit' ? 'wizard' : 'distribution'} boardId={boardId}>
    <PageHeading title={pageTitle} description={view === 'list' ? '自動応答・友だち追加時の配信・リマインダを、各アカウントへ下書きとして配ります。' : undefined} />
    {view === 'list' && <div className={styles.tabs} aria-label="配信設定の種類">{tabControls}</div>}
    {!canEdit && <Notice tone="info">閲覧のみで見ています。変更や配布は統括の管理者に頼んでください。</Notice>}
    {error && <Notice tone="validation">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    {view === 'edit' && selected ? <Card className={styles.editor}>
        <div className={styles.editorHead}><div><h2>{selected.template.id ? 'ひな形を編集する' : 'ひな形を作る'}</h2><p>{titleOf(type)}。保存すると配布先を選べます。</p></div><Button onClick={() => { setSelected(null); setPreflight(null) }}>一覧へ戻る</Button></div>
      <div className={styles.fields}>
        <label className={styles.field}><span>統括での名前</span><TextField disabled={!canEdit} value={selected.template.name} onChange={(event) => setSelected({ ...selected, template: { ...selected.template, name: event.target.value } })} /></label>
        <label className={styles.field}><span>説明</span><TextField disabled={!canEdit} value={selected.template.description ?? ''} onChange={(event) => setSelected({ ...selected, template: { ...selected.template, description: event.target.value } })} /></label>
        {field('name', '店に届く名前')}
        {type === 'auto_reply' && <>{field('keyword', 'キーワード')}
          <label className={styles.field}><span>一致方法</span><Select disabled={!canEdit} aria-label="一致方法" value={String(settings?.matchType ?? 'contains')} options={[{ value: 'contains', label: '含む' }, { value: 'exact', label: '完全一致' }]} onChange={(value) => updateSetting('matchType', value)} /></label>
          {field('responseContent', '返信内容', true)}</>}
        {type === 'friend_add_rule' && <>
          <label className={styles.field}><span>対象</span><Select disabled={!canEdit} aria-label="対象" value={String(settings?.friendKind ?? 'first_time')} options={[{ value: 'first_time', label: '初めての友だち' }, { value: 'returning', label: '再び追加した友だち' }]} onChange={(value) => updateSetting('friendKind', value)} /></label>
          {field('messageText', '最初に送る内容', true)}
        </>}
        {type === 'reminder' && <>{field('description', '説明')}
          <label className={styles.field}><span>配信方式</span><Select disabled={!canEdit} aria-label="配信方式" value={String(settings?.deliveryMode ?? 'time')} options={[{ value: 'time', label: '日時で送る' }, { value: 'countdown', label: '予定日から数えて送る' }]} onChange={(value) => updateSetting('deliveryMode', value)} /></label>
          {field('sendAtTime', '送る時刻')}</>}
      </div>
      <div className={styles.actions}><Button onClick={() => { setSelected(null); setView('list') }}>キャンセル</Button><Button variant="primary" disabled={!canEdit || busy || !selected.template.name.trim()} onClick={() => void save()}>{busy ? '保存中…' : '下書きを保存する'}</Button></div>
    </Card> : view === 'accounts' && selected ? <Card className={styles.editor}>
      <div className={styles.editorHead}><div><h2>配るアカウントを選ぶ</h2><p>配った設定は下書きで届き、店で公開や送信を確認できます。</p></div></div>
      <HqAccountPickerField accounts={accounts} value={selectedAccounts} onChange={setSelectedAccounts} disabled={!canEdit || busy} allowEmpty={false} description="フォルダごとにアカウントを選べます。" />
      <div className={styles.actions}><Button disabled={busy} onClick={() => setView('edit')}>あとで配る</Button><Button variant="primary" disabled={!canEdit || busy || !selectedAccounts.length} onClick={() => void prepare()}>配る前に確かめる</Button></div>
    </Card> : view === 'preflight' && selected && preflight ? <Card className={styles.editor}>
      <div className={styles.editorHead}><div><h2>配る内容を確かめる</h2><p>同じ名前がある設定は配り方を選びます。使用中や公開済みの内容は上書きされません。</p></div></div>
      <div className={styles.preflight}>{preflight.stores.map((store) => <section key={store.accountId}><h4>{store.accountName}</h4>{store.items.map((item) => <label className={styles.mode} key={`${store.accountId}:${item.sourceId}`}><span>{item.name}{item.duplicate ? '（同じ名前あり）' : ''}</span><Select aria-label={`${store.accountName}：${item.name}の配り方`} value={choices[`${store.accountId}:${item.sourceId}`] ?? ''} options={[{ value: '', label: '選んでください' }, ...item.allowedModes.map((mode) => ({ value: mode, label: mode === 'create' ? '新しく作る' : mode === 'overwrite' ? '下書きを上書きする' : '別名で作る' }))]} onChange={(value) => setChoices((old) => ({ ...old, [`${store.accountId}:${item.sourceId}`]: value }))} /></label>)}</section>)}</div>
      <div className={styles.actions}><Button disabled={busy} onClick={() => setView('accounts')}>アカウントを選び直す</Button><Button variant="primary" disabled={!canEdit || busy} onClick={() => void distribute()}>選んだ内容で配る</Button></div>
    </Card> : view === 'result' ? <Card className={styles.editor}>
      <div className={styles.editorHead}><div><h2>配布結果</h2><p>店には下書きとして届きます。公開や送信は各店で確認してから行います。</p></div></div>
      {distributionResult && <div className={styles.preflight} role="status">{distributionResult.stores.map((store) => <section key={store.accountId}><h4>{store.accountName ?? accounts.find((account) => account.id === store.accountId)?.name ?? 'アカウント'}：{store.status === 'succeeded' ? '配布済み' : store.status === 'pending' || store.status === 'staged' ? '確認中' : '配布できません'}{store.reason ? ` — ${store.reason}` : ''}</h4></section>)}</div>}
      <div className={styles.actions}><Button onClick={() => { setSelected(null); setView('list'); setNotice('') }}>一覧へ戻る</Button><Button variant="primary" onClick={() => { setSelected(null); setView('list'); setNotice('') }}>完了する</Button></div>
    </Card> : <Card className={styles.listCard}>
      <div className={styles.listHead}><div><h2>{titleOf(type)}のひな形</h2><p>配布する内容を下書きで保存します。</p></div>{canEdit && <Button variant="primary" onClick={create}>新しく作る</Button>}</div>
      {loading ? <p role="status">読み込み中…</p> : rows.length ? <ul className={styles.rows}>{rows.map((row) => <li key={row.id}><button type="button" onClick={() => void edit(row)}>{row.name}</button><span>版 {row.revision}</span><Button onClick={() => void edit(row)}>開く</Button></li>)}</ul> : <p>まだひな形がありません。新しく作って、アカウントへ配れます。</p>}
    </Card>}
  </PageFrame>
}
