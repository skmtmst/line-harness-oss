'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { Th } from '@/components/shared/table'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { usePageTitle } from '@/components/shell/page-chrome'
import { hqTemplatesApi, type TemplateType, type TemplateDetail, type TemplateInput, type TemplateDefinition, type HqTemplate, type HqAccount, type Preflight, type Resolution, type DistributionMode, type DistributionResult } from '@/lib/hq-templates-api'
import styles from './template-console.module.css'
import { clearCreationAttempt, loadCreationAttempt, persistCreationAttempt, sameCreationScope, type CreationAttempt, type CreationScope } from '@/lib/hq-template-create-attempt'
import TemplateDefinitionEditor, { definitionError, definitionForName, definitionName, freshDefinition, referenceCount } from './template-definition-editor'

const LABELS: Record<TemplateType, string> = { tag: 'タグ', template: 'テンプレート', rich_menu: 'リッチメニュー', form: '回答フォーム' }
const PAGE_TITLES: Record<TemplateType, string> = { tag: '友だち属性', template: 'テンプレート', rich_menu: 'リッチメニュー', form: '回答フォーム' }
const CREATE_LABELS: Record<TemplateType, string> = { tag: '＋ タグを追加', template: 'テンプレートを作る', rich_menu: 'メニューを作る', form: 'フォームを作る' }
const LIST_DESCRIPTIONS: Record<TemplateType, string> = {
  tag: 'タグのひな形を作成し、各LINEアカウントへ配布します。',
  template: 'メッセージのひな形を作成し、各LINEアカウントへ配布します。',
  rich_menu: 'リッチメニューのひな形を作成し、各LINEアカウントへ配布します。',
  form: '回答フォームのひな形を作成し、各LINEアカウントへ配布します。',
}
const MODES: Record<DistributionMode, string> = { create: '新規作成', overwrite: '上書き', alias: '別名で作成' }
const NODES = { list: 'rsyjI', edit: 'ZsLly', accounts: 'E0CmCp', duplicates: 'Uhd35', result: 'FxHyL' }
type Stage = keyof typeof NODES
const STEPS: readonly { stage: Stage; label: string }[] = [
  { stage: 'list', label: '一覧' },
  { stage: 'edit', label: 'ひな形' },
  { stage: 'accounts', label: '店舗' },
  { stage: 'duplicates', label: '重複確認' },
  { stage: 'result', label: '結果' },
]
const choiceKey = (account: string, source: string) => JSON.stringify([account, source])
const failedStores = (result: DistributionResult) => result.stores.filter(store => ['failed', 'version_conflict', 'unsupported'].includes(store.status))
const formatDate = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ja-JP') : '—'
const errorText = (error: unknown) => error instanceof Error ? error.message : '処理できませんでした。時間をおいて再確認してください。'

export function resolvedItems(preflight: Preflight, choices: Record<string, DistributionMode>): Resolution[] | null {
  if (!preflight.stores.length || preflight.stores.some(store => !store.items.length)) return null
  const result: Resolution[] = []
  for (const store of preflight.stores) for (const item of store.items) {
    const mode = item.duplicate ? choices[choiceKey(store.accountId, item.sourceId)] : 'create'
    if (!mode || !item.allowedModes.includes(mode)) return null
    result.push({ accountId: store.accountId, sourceId: item.sourceId, mode })
  }
  return result
}

export default function TemplateConsole({ type }: { type: TemplateType }) {
  const [stage, setStage] = useState<Stage>('list')
  const [templates, setTemplates] = useState<HqTemplate[]>([])
  const [accounts, setAccounts] = useState<HqAccount[]>([])
  const [detail, setDetail] = useState<TemplateDetail | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [definition, setDefinition] = useState<TemplateDefinition>(() => freshDefinition(type))
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [preflight, setPreflight] = useState<Preflight | null>(null)
  const [choices, setChoices] = useState<Record<string, DistributionMode>>({})
  const [result, setResult] = useState<DistributionResult | null>(null)
  const [pendingRun, setPendingRun] = useState<string | null>(null)
  const [requestBusy, setBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const busy = requestBusy || uploadBusy
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [message, setMessage] = useState('')
  const [remove, setRemove] = useState<HqTemplate | null>(null)
  const [now, setNow] = useState(Date.now())
  const lock = useRef(false)
  const createAttempt = useRef<CreationAttempt | null>(null)
  const creationScope = useRef<CreationScope | null>(null)
  const createSettlement = useRef<{ kind: 'saved'; detail: TemplateDetail } | { kind: 'rejected' } | null>(null)
  const [createUncertain, setCreateUncertain] = useState(false)
  const alive = useRef(true)
  usePageTitle(stage === 'list' ? PAGE_TITLES[type] : stage === 'edit' ? `${PAGE_TITLES[type]}の作成・編集` : stage === 'accounts' ? '配布先店舗を選択' : stage === 'duplicates' ? '重複確認と配布方法' : '配布結果')

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    let current = true
    setBusy(true)
    void Promise.all([hqTemplatesApi.list(type), hqTemplatesApi.accounts(), hqTemplatesApi.context()]).then(([rows, stores, scope]) => {
      if (current) {
        const attempt = loadCreationAttempt(window.sessionStorage, scope, type)
        creationScope.current = scope
        if (attempt) {
          createAttempt.current = attempt; setCreateUncertain(true); setDetail(null)
          setName(attempt.input.name); setDescription(attempt.input.description ?? ''); setDefinition(attempt.input.definition); setStage('edit')
        }
        setTemplates(rows); setAccounts(stores); setReady(true)
      }
    }).catch(e => { if (current) setError(errorText(e)) }).finally(() => { if (current) setBusy(false) })
    return () => { current = false }
  }, [type])
  useEffect(() => {
    if (stage !== 'duplicates') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [stage])

  const perform = async (action: () => Promise<void>) => {
    if (lock.current || !ready) return
    lock.current = true; setBusy(true); setError(''); setConflict(false); setMessage('')
    try { await action() } catch (e) {
      if (alive.current) {
        setError(errorText(e))
        setConflict(Boolean(e && typeof e === 'object' && 'status' in e && e.status === 409))
      }
    }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const toList = () => { if (createUncertain) return; createAttempt.current = null; setStage('list'); setSearch(''); setPreflight(null); setChoices({}); setPendingRun(null); setResult(null); setError(''); setConflict(false); window.history.replaceState(null, '', window.location.pathname + window.location.search) }
  const loadDetailIntoForm = (loaded: TemplateDetail) => {
    if (loaded.template.template_type !== type || loaded.definition.schemaVersion !== 1 || !definitionName(type, loaded.definition)) throw new Error('ひな形の種類または保存内容を確認できません。')
    setDetail(loaded); setName(loaded.template.name); setDescription(loaded.template.description ?? ''); setDefinition(loaded.definition)
  }
  const open = (id: string, next: Stage) => void perform(async () => {
    const loaded = await hqTemplatesApi.get(id)
    if (!alive.current) return
    loadDetailIntoForm(loaded); setSelected([]); setSearch(''); setPreflight(null); setChoices({}); setStage(next)
  })
  const save = (distribute: boolean) => void perform(async () => {
    const preparedDefinition = definitionForName(type, definition, name.trim(), description.trim())
    const validation = !name.trim() ? 'ひな形の名前を入力してください。' : definitionError(type, preparedDefinition, creationScope.current?.tenantId)
    if (validation) throw new Error(validation)
    const input = { type, name: name.trim(), description: description.trim(), definition: preparedDefinition } as TemplateInput
    let saved: TemplateDetail
    let continueToAccounts = distribute
    if (detail) {
      saved = await hqTemplatesApi.update(detail.template.id, { ...input, expectedRevision: detail.template.revision })
    } else {
      const scope = await hqTemplatesApi.context()
      if (!creationScope.current || !sameCreationScope(creationScope.current, scope)) throw new Error('ログイン中の所属先または利用者が変わりました。元のアカウントで再ログインしてから再読み込みしてください。')
      const attempt = createAttempt.current ?? { requestId: crypto.randomUUID(), input, distribute }
      // Persist before POST: reload/login navigation is an ambiguous outcome too.
      persistCreationAttempt(window.sessionStorage, scope, type, attempt)
      createAttempt.current = attempt
      continueToAccounts = attempt.distribute
      const retainAttempt = () => {
        setCreateUncertain(true)
        setName(attempt.input.name); setDescription(attempt.input.description ?? ''); setDefinition(attempt.input.definition)
      }
      const clearReceipt = () => {
        try { clearCreationAttempt(window.sessionStorage, scope, type, attempt.requestId) }
        catch (cause) { retainAttempt(); throw cause }
      }
      if (createSettlement.current?.kind === 'rejected') {
        clearReceipt()
        createSettlement.current = null; createAttempt.current = null; setCreateUncertain(false)
        setMessage('前回の保存は受け付けられていません。内容を確認して保存し直してください。')
        return
      }
      if (createSettlement.current?.kind === 'saved') saved = createSettlement.current.detail
      else {
        try {
          // If the response is lost, replay the exact key and payload. A known
          // result with failed local cleanup needs only another cleanup attempt.
          saved = await hqTemplatesApi.create(attempt.input, attempt.requestId)
        } catch (cause) {
          if (!createUncertain && cause && typeof cause === 'object' && 'requestNotApplied' in cause && cause.requestNotApplied === true) {
            createSettlement.current = { kind: 'rejected' }
            clearReceipt()
            createSettlement.current = null; createAttempt.current = null
          } else {
            // A later rejection cannot disprove an earlier ambiguous attempt.
            retainAttempt()
          }
          throw cause
        }
        createSettlement.current = { kind: 'saved', detail: saved }
      }
      clearReceipt()
      createSettlement.current = null
    }
    if (!alive.current) return
    loadDetailIntoForm(saved)
    createAttempt.current = null
    setCreateUncertain(false)
    setTemplates(current => [saved.template, ...current.filter(row => row.id !== saved.template.id)])
    setMessage('ひな形を保存しました。')
    if (continueToAccounts) { setSelected([]); setSearch(''); setStage('accounts') }
    else setStage('list')
  })
  const checkStores = (ids: string[]) => void perform(async () => {
    if (!detail || !ids.length) return
    const checked = await hqTemplatesApi.preflight(detail.template.id, ids)
    // Never execute a preflight that does not match the selected destination set.
    if (checked.stores.length !== ids.length || new Set(checked.stores.map(s => s.accountId)).size !== ids.length || checked.stores.some(s => !ids.includes(s.accountId))) throw new Error('配布先を確認できませんでした。もう一度店舗を選択してください。')
    if (!alive.current) return
    setPendingRun(null); setPreflight(checked); setChoices({}); setSelected(ids); setNow(Date.now()); setStage('duplicates')
  })
  const bulk = (mode: DistributionMode) => {
    if (!preflight || busy) return
    setChoices(current => {
      const next = { ...current }
      for (const store of preflight.stores) for (const item of store.items) if (item.duplicate && item.allowedModes.includes(mode)) next[choiceKey(store.accountId, item.sourceId)] = mode
      return next
    })
  }
  const rememberRun = (templateId: string, runId: string) => {
    // This reference contains no payload or authentication data; reload only GETs the existing run.
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${new URLSearchParams({ template: templateId, run: runId })}`)
  }
  const run = () => void perform(async () => {
    if (!detail || !preflight || pendingRun) return
    const resolutions = resolvedItems(preflight, choices)
    if (!resolutions || Date.parse(preflight.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(preflight.expiresAt))) throw new Error('確認の有効期限、または未選択の項目を確認してください。')
    setPendingRun(preflight.preflightId); setResult(null); setStage('result'); rememberRun(detail.template.id, preflight.preflightId)
    try {
      const completed = await hqTemplatesApi.distribute(detail.template.id, preflight.preflightId, resolutions)
      if (completed.runId !== preflight.preflightId) throw new Error('配布番号が一致しません。結果を再確認してください。')
      if (alive.current) setResult(completed)
    } catch {
      // An interrupted POST is ambiguous. Do not send it again or invent a failure/success.
      try {
        const recovered = await hqTemplatesApi.result(detail.template.id, preflight.preflightId)
        if (recovered.runId !== preflight.preflightId) throw new Error('配布番号が一致しません。')
        if (alive.current) setResult(recovered)
      } catch { throw new Error('配布結果をまだ確認できません。再配布せず「結果を再確認」を押してください。') }
    }
  })
  const refreshResult = () => void perform(async () => {
    if (!detail || !pendingRun) return
    const loaded = await hqTemplatesApi.result(detail.template.id, pendingRun)
    if (loaded.runId !== pendingRun) throw new Error('配布番号が一致しません。')
    if (alive.current) setResult(loaded)
  })
  useEffect(() => {
    if (!ready || createAttempt.current) return
    const params = new URLSearchParams(window.location.hash.slice(1))
    const id = params.get('template'), runId = params.get('run')
    if (!id || !runId) return
    void perform(async () => {
      const loaded = await hqTemplatesApi.get(id)
      if (!alive.current) return
      loadDetailIntoForm(loaded); setPendingRun(runId); setStage('result')
      const restored = await hqTemplatesApi.result(id, runId)
      if (restored.runId !== runId) throw new Error('配布番号が一致しません。')
      if (alive.current) setResult(restored)
    })
    // Restore once after the authorized list/accounts have loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
  const expiry = preflight ? Date.parse(preflight.expiresAt) : NaN
  const expired = !Number.isFinite(expiry) || expiry <= now
  const resolutions = preflight ? resolvedItems(preflight, choices) : null
  const duplicates = preflight?.stores.flatMap(store => store.items.filter(item => item.duplicate)) ?? []
  const shownAccounts = accounts.filter(account => account.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const done = result && result.status !== 'running'
  const failures = result ? failedStores(result) : []
  const successes = result?.stores.filter(store => store.status === 'succeeded') ?? []
  const totals = successes.reduce((sum, store) => ({ created: sum.created + store.counts.created, overwritten: sum.overwritten + store.counts.overwritten, aliased: sum.aliased + store.counts.aliased }), { created: 0, overwritten: 0, aliased: 0 })
  const accountName = (id: string) => accounts.find(account => account.id === id)?.name ?? id
  const title = stage === 'list' ? PAGE_TITLES[type] : stage === 'edit' ? `${LABELS[type]}のひな形を${detail ? '編集' : '作成'}` : stage === 'accounts' ? '配布先店舗を選択' : stage === 'duplicates' ? `重複する項目が${duplicates.length}件あります` : done ? '配布が完了しました' : '配布結果を確認しています'
  const validation = definitionError(type, definitionForName(type, definition, name.trim(), description.trim()), creationScope.current?.tenantId)

  return <div className={styles.console} data-design-node={NODES[stage]} aria-busy={busy}>
    {stage !== 'list' && <nav aria-label="配布の進捗"><ol className={styles.steps}>{STEPS.map((step, i) => <li key={step.stage} aria-current={step.stage === stage ? 'step' : undefined}>{i + 1} {step.label}</li>)}</ol></nav>}
    {stage === 'edit' && <p className={styles.breadcrumb}><button type="button" disabled={busy || createUncertain} onClick={toList}>ひな形一覧</button> / {detail ? '編集' : '新規作成'}</p>}
    <header className={styles.header}><div><h1>{title}</h1><p className={styles.muted}>{stage === 'list' ? LIST_DESCRIPTIONS[type] : stage === 'accounts' ? '1店舗だけ、または複数店舗を選択して一括配布できます' : stage === 'duplicates' ? '一括設定のあと、必要な項目だけ個別に変更できます' : stage === 'edit' ? `LINEアカウント内と同じ項目で${LABELS[type]}のひな形を作成します` : detail?.template.name}</p></div>
      {stage === 'list' && <Button aria-label="＋ひな形を作成" variant="primary" disabled={!ready || busy} onClick={() => { createAttempt.current = null; setDetail(null); setName(''); setDescription(''); setDefinition(freshDefinition(type)); setStage('edit'); setError(''); setConflict(false) }}>{CREATE_LABELS[type]}</Button>}
    </header>
    {error && <div role="alert" className={`${styles.notice} ${styles.error}`}><p>{error}</p>{conflict && detail && <Button disabled={busy} onClick={() => open(detail.template.id, 'edit')}>最新の内容を読み込む</Button>}</div>}
    {message && <p role="status" className={`${styles.notice} ${styles.success}`}>{message}</p>}
    {stage === 'list' && <>
      {!ready ? <section className={`${styles.panel} ${styles.empty}`}><p role="status">{busy ? 'ひな形を読み込み中…' : '読み込めませんでした。権限や接続を確認し、ページを再読み込みしてください。'}</p></section> : <>
        <div className={styles.toolbar}><input aria-label="ひな形を検索" className={`${styles.input} ${styles.search}`} placeholder="名前で検索" value={search} onChange={e => setSearch(e.target.value)} /><span>{templates.length}件</span></div>
        <div className={styles.panel}><table className={styles.table}><thead><tr><Th style={{ width: '28%' }}>名前</Th><Th className={styles.optional}>参照先</Th><Th className={styles.optional}>更新日時</Th><Th>配布先</Th><Th style={{ width: '12%' }}>操作</Th></tr></thead><tbody>{templates.filter(row => row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(row => <tr key={row.id}><td data-label="名前"><span className={styles.name} title={row.name}>{row.name}</span><small className={styles.muted}>{LABELS[row.template_type]}</small></td><td data-label="参照先" className={styles.optional}><span className={styles.name} title={row.reference_summary}>{row.reference_summary ?? '—'}</span></td><td data-label="更新日時" className={styles.optional}>{formatDate(row.updated_at)}</td><td data-label="配布先">{row.distributed_account_count === undefined ? '—' : row.distributed_account_count ? `${row.distributed_account_count}店舗` : '未配布'}</td><td data-label="操作"><details className={styles.menu}><summary aria-label={`${row.name}の操作`}>…</summary><div className={styles.menuItems}><Button disabled={busy} onClick={() => open(row.id, 'edit')} aria-label={`${row.name}を編集`}>編集</Button><Button disabled={busy} onClick={() => open(row.id, 'accounts')} aria-label={`${row.name}を配布`}>配布</Button><Button disabled={busy} onClick={() => setRemove(row)} aria-label={`${row.name}を削除`}>削除</Button></div></details></td></tr>)}</tbody></table>{!templates.some(row => row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p className={styles.empty}>{templates.length ? '検索に一致するひな形はありません。' : 'まだひな形がありません。最初のひな形を作成してください。'}</p>}</div>
      </>}
    </>}
    {stage === 'edit' && <>
      <div className={styles.grid}><div className={styles.stack}><section className={styles.panel}>
        <label className={styles.field}><span>種類</span><input className={styles.input} value={LABELS[type]} readOnly /></label>
        <label className={styles.field}><span>名前</span><input className={styles.input} value={name} maxLength={200} disabled={busy || createUncertain} onChange={e => setName(e.target.value)} /></label>
        <label className={styles.field}><span>説明</span><textarea className={styles.input} value={description} maxLength={2000} rows={2} disabled={busy || createUncertain} onChange={e => setDescription(e.target.value)} /></label>
        <TemplateDefinitionEditor
          type={type}
          value={definition}
          disabled={busy || createUncertain}
          tenantId={creationScope.current?.tenantId}
          onChange={setDefinition}
          onBusyChange={setUploadBusy}
          onRichMenuNameChange={setName}
          richMenuReferences={{
            tags: templates.filter(item => item.template_type === 'tag').map(item => ({ id: item.id, name: item.name })),
            templates: templates.filter(item => item.template_type === 'template').map(item => ({ id: item.id, name: item.name })),
            forms: templates.filter(item => item.template_type === 'form').map(item => ({ id: item.id, name: item.name })),
          }}
        />
      </section></div><aside className={styles.stack}><section className={styles.panel}><h2>保存状態</h2><p>{detail ? name !== detail.template.name || description !== (detail.template.description ?? '') || JSON.stringify(definition) !== JSON.stringify(detail.definition) ? '未保存の変更あり' : '保存済み' : '下書き'}</p>{detail && <p className={styles.muted}>{formatDate(detail.template.updated_at)}</p>}</section><section className={styles.panel}><h2>店舗での見え方</h2><span className={`${styles.badge} ${styles.success}`}>{name || `${LABELS[type]}名`}</span><p className={styles.muted}>参照先 {referenceCount(type, definition)}件を含めて配布します。</p></section></aside></div>
      {createUncertain && <Notice tone="validation" message="前回の保存結果がまだ確定していません。重複を防ぐため入力を固定しています。同じ依頼を再確認し、保存済みならその結果を読み込みます。" />}
      <footer className={styles.footer}><Button disabled={busy || createUncertain} onClick={toList}>キャンセル</Button>{createUncertain ? <Button variant="primary" disabled={busy} onClick={() => save(false)}>前回の保存を再確認</Button> : <><Button disabled={busy || Boolean(validation)} onClick={() => save(false)}>下書き保存</Button><Button variant="primary" disabled={busy || Boolean(validation)} onClick={() => save(true)}>保存して配布先を選ぶ</Button></>}</footer>
    </>}
    {stage === 'accounts' && <>
      <div className={styles.grid}><section className={styles.panel}><div className={styles.toolbar}><input aria-label="店舗を検索" className={`${styles.input} ${styles.search}`} placeholder="店舗名で検索" value={search} onChange={e => setSearch(e.target.value)} /><label><input type="checkbox" disabled={busy || !shownAccounts.length} checked={!!shownAccounts.length && shownAccounts.every(a => selected.includes(a.id))} onChange={e => setSelected(current => e.target.checked ? [...new Set([...current, ...shownAccounts.map(a => a.id)])] : current.filter(id => !shownAccounts.some(a => a.id === id)))} /> 表示中をすべて選択</label></div>
        {shownAccounts.map(account => <div key={account.id} className={styles.account}><label className={styles.accountChoice}><input type="checkbox" aria-label={account.name} checked={selected.includes(account.id)} disabled={busy} onChange={e => setSelected(current => e.target.checked ? [...current, account.id] : current.filter(id => id !== account.id))} /><span className={styles.name} title={account.name}>{account.name}</span></label><Button disabled={busy} onClick={() => checkStores([account.id])}>{account.name}だけに配布</Button></div>)}{!shownAccounts.length && <p className={styles.empty}>選択できる店舗がありません。</p>}
      </section><aside className={styles.stack}><section className={styles.panel}><h2>配布するひな形</h2><p>{detail?.template.name}</p><p className={styles.muted}>参照先 {referenceCount(type, definition)}件を含む</p></section><section className={`${styles.panel} ${styles.success}`}><h2>選択済み</h2><strong className={styles.selection}>{selected.length}店舗</strong><p>{selected.map(accountName).join('・')}</p></section><p className={styles.notice}>次に重複を確認します。既存の同名項目は店舗ごとに上書き・別名を選べます。</p></aside></div>
      <footer className={styles.footer}><Button disabled={busy} onClick={toList}>戻る</Button><Button aria-label={`${selected.length}店舗の重複を確認`} variant="primary" disabled={busy || !selected.length} onClick={() => checkStores(selected)}>{selected.length === 1 ? '選択した1店舗へ配布' : `選択した${selected.length}店舗へ一括配布`}</Button></footer>
    </>}
    {stage === 'duplicates' && preflight && <>
      <p className={styles.notice}>参照先の重複も含みます。「既存を使用」は内容を変更せず、選んだ版の参照先を使います。上書きできない項目は「別名で作成」を選んでください。</p>
      <div className={styles.toolbar}><div><strong>一括設定</strong><p className={styles.muted}>個別設定で変更できます</p></div><div className={styles.actions}><Button disabled={busy} onClick={() => bulk('overwrite')}>上書き・再利用を一括指定</Button><Button disabled={busy} variant="primary" onClick={() => bulk('alias')}>すべて別名で作成</Button></div></div>
      <section className={styles.panel}><table className={styles.table}><thead><tr><Th>店舗</Th><Th>項目</Th><Th className={styles.optional}>配布先の版</Th><Th>配布方法</Th></tr></thead><tbody>{preflight.stores.flatMap(store => store.items.map(item => <tr key={choiceKey(store.accountId, item.sourceId)}><td data-label="店舗"><span className={styles.name} title={store.accountName}>{store.accountName}</span></td><td data-label="項目"><span className={styles.name} title={item.name}>{item.name}</span><span className={styles.muted}>{item.itemKind === 'folder' ? 'タググループ' : item.itemKind === 'rich_menu' ? 'リッチメニュー' : item.itemKind === 'form' ? '回答フォーム' : item.itemKind === 'media' ? '登録メディア' : item.itemKind === 'template' ? 'テンプレート' : item.itemKind}</span></td><td data-label="配布先の版" className={styles.optional}>{item.expectedRevision ?? '新規'}</td><td data-label="配布方法">{item.duplicate ? <div role="group" aria-label={`${store.accountName} ${item.name}の配布方法`} className={styles.actions}>{(item.operation === 'reuse' ? ['overwrite'] as const : ['overwrite', 'alias'] as const).map(mode => <Button key={mode} disabled={busy || !item.allowedModes.includes(mode)} variant={choices[choiceKey(store.accountId, item.sourceId)] === mode ? 'primary' : 'secondary'} aria-pressed={choices[choiceKey(store.accountId, item.sourceId)] === mode} onClick={() => setChoices(current => ({ ...current, [choiceKey(store.accountId, item.sourceId)]: mode }))}>{item.operation === 'reuse' && mode === 'overwrite' ? '既存を使用' : MODES[mode]}</Button>)}</div> : '新規作成'}</td></tr>))}</tbody></table></section>
      <p className={`${styles.notice} ${styles.error}`}>配布直前に版を再確認します。配布先で編集があれば、その店舗の変更を取り消します。</p>
      {expired && <p role="alert">確認の有効期限が切れました。店舗の現在版をもう一度確認してください。</p>}
      <p className={styles.muted}>成功済み店舗は保持され、失敗分だけ再確認できます。別名は店舗内で重複しない名前になります。</p>
      <footer className={styles.footer}><Button disabled={busy} onClick={() => { setPreflight(null); setStage('accounts') }}>戻る</Button>{expired && <Button disabled={busy} onClick={() => checkStores(selected)}>現在版を再確認</Button>}<Button variant="primary" disabled={busy || expired || !resolutions || !!pendingRun} onClick={run}>この内容で{preflight.stores.length}店舗へ配布</Button></footer>
    </>}
    {stage === 'result' && <>
      <div className={styles.toolbar}><p className={styles.muted}>配布番号：{pendingRun}</p><Button disabled={busy} onClick={refreshResult}>結果を再確認</Button></div>
      {!result ? <p className={`${styles.panel} ${styles.empty}`} role="status">結果を確認中です。確認できるまでは再配布しません。</p> : <>
        <div className={styles.metrics}>{[['成功', `${successes.length}店舗`], ['失敗', `${failures.length}店舗`], ['新規作成', `${totals.created}件`], ['上書き', `${totals.overwritten}件`], ['別名作成', `${totals.aliased}件`]].map(([label, value]) => <section key={label} className={styles.panel}><span>{label}</span><strong>{value}</strong></section>)}</div>
        <div className={styles.grid}><div className={styles.stack}>{result.stores.map(store => <section key={store.accountId} className={`${styles.panel} ${failures.includes(store) ? styles.failed : ''}`}><div className={styles.toolbar}><h2>{store.accountName ?? accountName(store.accountId)}</h2><span className={styles.badge}>{store.status === 'succeeded' ? '成功' : failures.includes(store) ? '失敗' : '確認中'}</span></div>
          {store.status === 'succeeded' ? <p>新規 {store.counts.created}件　上書き {store.counts.overwritten}件　別名 {store.counts.aliased}件{Boolean(store.counts.reused) && <>　既存参照 {store.counts.reused}件を再利用</>}</p> : failures.includes(store) ? <><p>この店舗の変更は取り消しました</p><p className={`${styles.notice} ${styles.error}`}>{store.reason || '配布できませんでした。店舗の現在版を再確認してください。'}</p>{store.cleanupPending && <p className={styles.notice}>画像の後片付けを自動で再試行中です。「結果を再確認」で状態を更新できます。</p>}{done && <div className={styles.footer}><Button variant="primary" disabled={busy} onClick={() => { checkStores([store.accountId]) }}>この店舗だけ再確認して配布</Button></div>}</> : <p>まだ処理の完了を確認できていません。</p>}
        </section>)}</div><aside className={styles.panel}><h2>再実行の動作</h2><p>成功店舗は再送せず、失敗店舗の現在版を取得して重複確認へ戻ります。</p></aside></div>
      </>}
      <footer className={styles.footer}><Button disabled={busy} onClick={toList}>ひな形一覧へ</Button>{done && failures.length > 0 && <Button variant="primary" disabled={busy} onClick={() => { checkStores(failures.map(s => s.accountId)) }}>失敗{failures.length}店舗を再確認</Button>}</footer>
    </>}
    <ConfirmDialog open={!!remove} title="ひな形を削除" description={`「${remove?.name ?? ''}」を削除します。配布済みの店舗データは残ります。`} destructive confirmLabel="削除する" busy={busy} onCancel={() => { if (!busy) setRemove(null) }} onConfirm={() => void perform(async () => { if (!remove) return; await hqTemplatesApi.remove(remove.id, remove.revision); setTemplates(current => current.filter(t => t.id !== remove.id)); setRemove(null); setMessage('ひな形を削除しました。') })} />
  </div>
}
