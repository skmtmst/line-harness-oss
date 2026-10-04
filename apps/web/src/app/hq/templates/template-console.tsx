'use client'

import '@/app/hq/readonly-v8.css'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import MenuPortal from '@/components/shared/menu-portal'
import Notice from '@/components/shared/notice'
import { Th } from '@/components/shared/table'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { usePageTitle } from '@/components/shell/page-chrome'
import { hqTemplatesApi, type TemplateType, type TemplateDetail, type TemplateInput, type TemplateDefinition, type HqTemplate, type HqAccount, type Preflight, type Resolution, type DistributionMode, type DistributionResult } from '@/lib/hq-templates-api'
import styles from './template-console.module.css'
import { clearCreationAttempt, loadCreationAttempt, persistCreationAttempt, sameCreationScope, type CreationAttempt, type CreationScope } from '@/lib/hq-template-create-attempt'
import TemplateDefinitionEditor, { definitionError, definitionForName, definitionName, freshDefinition, referenceCount } from './template-definition-editor'
import TemplateMessageFormV8 from './template-message-v8'
import { formatDateTime } from '@/lib/format'

const LABELS: Record<TemplateType, string> = { tag: 'タグ', template: 'テンプレート', rich_menu: 'リッチメニュー', form: '回答フォーム', scenario: 'シナリオ' }
const PAGE_TITLES: Record<TemplateType, string> = { tag: '友だち属性', template: 'テンプレート', rich_menu: 'リッチメニュー', form: '回答フォーム', scenario: 'シナリオ' }
const CREATE_LABELS: Record<TemplateType, string> = { tag: '＋ タグを作る', template: 'テンプレートを作る', rich_menu: 'メニューを作る', form: 'フォームを作る', scenario: 'シナリオを作る' }
const LIST_DESCRIPTIONS: Record<TemplateType, string> = {
  tag: 'タグのひな形を作成し、各LINEアカウントへ配布します。',
  template: 'メッセージのひな形を作成し、各LINEアカウントへ配布します。友だち属性・リッチメニュー・回答フォームも同じ形です。配るときは、行の「アカウントへ配る」から。',
  rich_menu: 'リッチメニューのひな形を作成し、各LINEアカウントへ配布します。',
  scenario: 'シナリオのひな形を作り、停止中の下書きとして各LINEアカウントへ配布します。',
  form: '回答フォームのひな形を作成し、各LINEアカウントへ配布します。',
}
const MODES: Record<DistributionMode, string> = { create: '新規作成', overwrite: '上書き', alias: '別名で作成' }
const NODES = { list: 'rsyjI', edit: 'X4JcOf', accounts: 'meBRB', duplicates: 'meBRB', result: 'FxHyL' }
type Stage = keyof typeof NODES
const STEPS: readonly { stage: Stage; label: string }[] = [
  { stage: 'list', label: '一覧' },
  { stage: 'edit', label: 'ひな形' },
  { stage: 'accounts', label: 'アカウント' },
  { stage: 'duplicates', label: '重複確認' },
  { stage: 'result', label: '結果' },
]
const choiceKey = (account: string, source: string) => JSON.stringify([account, source])
const failedStores = (result: DistributionResult) => result.stores.filter(store => ['failed', 'version_conflict', 'unsupported'].includes(store.status))
const formatDate = (value: string) => Number.isFinite(Date.parse(value)) ? formatDateTime(value) : '—'
const errorText = (error: unknown) => error instanceof Error ? error.message : '処理できませんでした。時間をおいて再確認してください。'

/**
 * R568: ひな形が指している画像の保存先だけを集める。保存や取り消しの境目で、
 * 今回送った鍵と突き合わせて、使われなかった分だけ後片付けする。
 */
export function uploadedKeysIn(definition: TemplateDefinition): string[] {
  if ('media' in definition && Array.isArray(definition.media)) return definition.media.map(item => item.r2Key).filter(key => key.trim() !== '')
  if ('richMenu' in definition) return definition.richMenu.pages.map(page => page.imageR2Key).filter(key => key.trim() !== '')
  return []
}

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

/**
 * 一覧の行の「…」。表の枠（`overflow`）の中にあっても切られないよう、
 * 中身は共通の器（`MenuPortal`）で最上層に出す。下に場所が無ければ
 * 上へ、右に無ければ左へ寄る。できること（編集・配布・削除）は変えない。
 */
function TemplateRowMenu({ name, busy, onEdit, onDistribute, onRemove, onDuplicate }: {
  name: string
  busy: boolean
  onEdit: () => void
  onDistribute: () => void
  onDuplicate?: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const close = () => setOpen(false)
  // 矢印・Home・Endで中の押し口を移動する（共通ActionMenuと同じ動き）。
  const moveMenuFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'))
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
    items[next].focus()
  }
  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        aria-label={`${name}の操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={styles.rowMenuTrigger}
      >
        …
      </button>
      <MenuPortal open={open} align="end" getAnchor={() => triggerRef.current} onClose={close}>
        <div role="menu" aria-label={`${name}の操作`} className={styles.rowMenuItems} style={{ position: 'static' }} onKeyDown={moveMenuFocus}>
          <Button disabled={busy} onClick={() => { onEdit(); close() }} aria-label={`${name}を編集`}>編集</Button>
          <Button disabled={busy} onClick={() => { onDistribute(); close() }} aria-label={`${name}をアカウントへ配る`}>アカウントへ配る</Button>
          {onDuplicate && <Button disabled={busy} onClick={() => { onDuplicate(); close() }} aria-label={`${name}を複製`}>複製</Button>}
          <Button disabled={busy} onClick={() => { onRemove(); close() }} aria-label={`${name}を削除`}>削除する</Button>
        </div>
      </MenuPortal>
    </>
  )
}

export default function TemplateConsole({ type, useCanonicalEditors = true }: { type: TemplateType; useCanonicalEditors?: boolean }) {
  const theme = useAdminTheme()
  const [stage, setStage] = useState<Stage>('list')
  const [folders, setFolders] = useState<import('@line-crm/shared').HqTemplateFolder[]>([])
  const [textOverrides,setTextOverrides] = useState<Record<string,string>>({})
  const duplicateAttempts = useRef(new Map<string, string>())
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folderFilter, setFolderFilter] = useState<string>('all')
  const [folderName, setFolderName] = useState('')
  const [folderLoadFailed, setFolderLoadFailed] = useState(false)
  useEffect(() => {
    if (theme !== 'v8') return
    let alive = true
    void hqTemplatesApi.folders.list().then(rows => { if (alive) setFolders(rows) }).catch(() => { if (alive) setFolderLoadFailed(true) })
    return () => { alive = false }
  }, [theme])
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
  /*
   * R119: 参照先に選べる別種類の目録。一覧の `templates` は編集中の種類だけ
   * しか持たないため、そこから別種類で絞ると常に空になる。種類を指定せず
   * 取った全部入りを別に持ち、参照候補はここから作る。`null` は未取得か
   * 取得失敗（0件とは区別する）。
   */
  const [catalog, setCatalog] = useState<HqTemplate[] | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [message, setMessage] = useState('')
  const [remove, setRemove] = useState<HqTemplate | null>(null)
  const [now, setNow] = useState(Date.now())
  /** R561: 連続作成のたびに正規編集部品を掛け直し、空の新規入力へ戻す番号。 */
  const [formKey, setFormKey] = useState(0)
  const lock = useRef(false)
  /** R568: この編集で送ったが、まだ保存内容に残っていない画像の保存先。 */
  const sessionUploads = useRef<string[]>([])
  /**
   * R568: 残す鍵以外を後片付けする。所有確認はサーバが行う。
   * 失敗しても移動や保存を止めない（残った分は次回の保存・取り消しで拾う）。
   */
  const reconcileSessionUploads = (keep: readonly string[]) => {
    const kept = new Set(keep)
    for (const key of sessionUploads.current) if (!kept.has(key)) void hqTemplatesApi.deleteImage(key).catch(() => undefined)
    sessionUploads.current = []
  }
  const noteSessionUpload = (media: { r2Key: string }) => {
    if (!sessionUploads.current.includes(media.r2Key)) sessionUploads.current.push(media.r2Key)
  }
  const createAttempt = useRef<CreationAttempt | null>(null)
  const creationScope = useRef<CreationScope | null>(null)
  const createSettlement = useRef<{ kind: 'saved'; detail: TemplateDetail } | { kind: 'rejected' } | null>(null)
  const [createUncertain, setCreateUncertain] = useState(false)
  const alive = useRef(true)
  usePageTitle(stage === 'list' ? PAGE_TITLES[type] : stage === 'edit' ? `${PAGE_TITLES[type]}の作成・編集` : stage === 'accounts' ? '配布先アカウントを選択' : stage === 'duplicates' ? '重複確認と配布方法' : '配布結果')

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
    // R119: 目録だけの失敗で一覧や保存まで止めない。失敗は `catalogFailed`
    // として編集欄の上で知らせ、候補が0件のときとは文を分ける。
    void hqTemplatesApi.list().then(
      (rows) => { if (current) { setCatalog(rows); setCatalogFailed(false) } },
      () => { if (current) { setCatalog(null); setCatalogFailed(true) } },
    )
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
  const toList = () => { if (createUncertain) return; reconcileSessionUploads(detail ? uploadedKeysIn(detail.definition) : []); createAttempt.current = null; setStage('list'); setSearch(''); setPreflight(null); setChoices({}); setPendingRun(null); setResult(null); setError(''); setConflict(false); window.history.replaceState(null, '', window.location.pathname + window.location.search) }
  /** R119: 目録の読み直し。編集中身は残し、候補だけ取り直す。 */
  const reloadCatalog = () => {
    setCatalogFailed(false)
    void hqTemplatesApi.list().then(
      (rows) => { if (alive.current) { setCatalog(rows); setCatalogFailed(false) } },
      () => { if (alive.current) { setCatalog(null); setCatalogFailed(true) } },
    )
  }
  /** R119: 参照候補は全部入りの目録から種類別に取り出す。一覧の `templates` は使わない。 */
  const referenceOptions = (kind: TemplateType) => (catalog ?? []).filter(item => item.template_type === kind).map(item => ({ id: item.id, name: item.name }))
  const loadDetailIntoForm = (loaded: TemplateDetail) => {
    if (loaded.template.template_type !== type || loaded.definition.schemaVersion !== 1 || !definitionName(type, loaded.definition)) throw new Error('ひな形の種類または保存内容を確認できません。')
    setFolderId(loaded.template.folder_id ?? null); setDetail(loaded); setName(loaded.template.name); setDescription(loaded.template.description ?? ''); setDefinition(loaded.definition)
  }
  const open = (id: string, next: Stage) => void perform(async () => {
    sessionUploads.current = []
    const loaded = await hqTemplatesApi.get(id)
    if (!alive.current) return
    loadDetailIntoForm(loaded); setSelected([]); setSearch(''); setPreflight(null); setChoices({}); setStage(next)
  })
  const save = (distribute: boolean, sourceDefinition = definition, sourceName = name, sourceDescription = description, andAnother = false) => perform(async () => {
    const preparedDefinition = definitionForName(type, sourceDefinition, sourceName.trim(), sourceDescription.trim())
    const validation = !sourceName.trim() ? 'ひな形の名前を入力してください。' : definitionError(type, preparedDefinition, creationScope.current?.tenantId)
    if (validation) throw new Error(validation)
    const input = { type, name: sourceName.trim(), description: sourceDescription.trim(), ...(theme === 'v8' ? { folderId } : {}), definition: preparedDefinition } as TemplateInput
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
    const isNew = !detail
    loadDetailIntoForm(saved)
    reconcileSessionUploads(uploadedKeysIn(saved.definition))
    createAttempt.current = null
    setCreateUncertain(false)
    setTemplates(current => [saved.template, ...current.filter(row => row.id !== saved.template.id)])
    setMessage('ひな形を保存しました。')
    if (continueToAccounts) { setSelected([]); setTextOverrides({}); setSearch(''); setStage('accounts') }
    // R561: 「保存して続けて作る」は新規作成のときだけ、保存済みの行を残したまま空の新規入力へ戻る。
    else if (andAnother && isNew) { setDetail(null); setFolderId(null); setName(''); setDescription(''); setDefinition(freshDefinition(type)); setFormKey(current => current + 1); setStage('edit') }
    else setStage('list')
  })
  const checkStores = (ids: string[]) => void perform(async () => {
    if (!detail || !ids.length) return
    const overrides = theme==='v8' && type==='template' && 'template' in definition && definition.template.messageType==='text' ? ids.filter(id=>textOverrides[id] !== undefined).map(accountId=>({accountId,text:textOverrides[accountId]})) : undefined
    const checked = await (overrides?.length ? hqTemplatesApi.preflight(detail.template.id, ids, overrides) : hqTemplatesApi.preflight(detail.template.id, ids))
    // Never execute a preflight that does not match the selected destination set.
    if (checked.stores.length !== ids.length || new Set(checked.stores.map(s => s.accountId)).size !== ids.length || checked.stores.some(s => !ids.includes(s.accountId))) throw new Error('配布先を確認できませんでした。もう一度アカウントを選択してください。')
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
  const title = stage === 'list' ? PAGE_TITLES[type] : stage === 'edit' ? `${LABELS[type]}のひな形を${detail ? '編集' : '作成'}` : stage === 'accounts' ? '配布先アカウントを選択' : stage === 'duplicates' ? `重複する項目が${duplicates.length}件あります` : done ? '配布が完了しました' : '配布結果を確認しています'
  const validation = definitionError(type, definitionForName(type, definition, name.trim(), description.trim()), creationScope.current?.tenantId)
  const canonicalEditorOwnsSave = useCanonicalEditors && (type === 'tag' || type === 'form')
  const saveCanonicalDefinition = async (next: TemplateDefinition, andAnother = false) => {
    const nextName = definitionName(type, next)
    const nextDescription = 'tag' in next ? next.tag.description ?? '' : 'form' in next ? next.form.description ?? '' : description
    setDefinition(next); setName(nextName); setDescription(nextDescription)
    await save(false, next, nextName, nextDescription, andAnother)
  }

  return <div className={`${styles.console} ${theme === 'v8' && stage === 'list' ? 'v8-ro-hq-page' : ''}`} data-design-node={theme === 'v8' && stage === 'list' ? 'LRc93' : NODES[stage]} aria-busy={busy}>
    {stage !== 'list' && <nav aria-label="配布の進捗"><ol className={styles.steps}>{STEPS.map((step, i) => <li key={step.stage} aria-current={step.stage === stage ? 'step' : undefined}>{i + 1} {step.label}</li>)}</ol></nav>}
    {stage === 'edit' && <p className={styles.breadcrumb}><button type="button" disabled={busy || createUncertain} onClick={toList}>ひな形一覧</button> / {detail ? '編集' : '新規作成'}</p>}
    <header className={styles.header}><div><h1>{title}</h1><p className={styles.muted}>{stage === 'list' ? LIST_DESCRIPTIONS[type] : stage === 'accounts' ? '1アカウントだけ、または複数アカウントを選択して一括配布できます' : stage === 'duplicates' ? '一括設定のあと、必要な項目だけ個別に変更できます' : stage === 'edit' ? `LINEアカウント内と同じ項目で${LABELS[type]}のひな形を作成します` : detail?.template.name}</p></div>
      {stage === 'list' && <Button aria-label="＋ひな形を作る" variant="primary" disabled={!ready || busy} onClick={() => { createAttempt.current = null; sessionUploads.current = []; setDetail(null); setFolderId(null); setName(''); setDescription(''); setDefinition(freshDefinition(type)); setStage('edit'); setError(''); setConflict(false) }}>{CREATE_LABELS[type]}</Button>}
    </header>
    {error && <div role="alert" className={`${styles.notice} ${styles.error}`}><p>{error}</p>{conflict && detail && <Button disabled={busy} onClick={() => open(detail.template.id, 'edit')}>最新の内容を読み込む</Button>}</div>}
    {message && <p role="status" className={`${styles.notice} ${styles.success}`}>{message}</p>}
    {stage === 'list' && <>
      {theme === 'v8' && <nav aria-label="ひな形の種類" className={styles.actions}>{Object.entries(LABELS).map(([key,label])=><a key={key} href={`/hq/templates?type=${key}`} aria-current={type===key?'page':undefined}>{label}</a>)}</nav>}
      {!ready ? <section className={`${styles.panel} ${styles.empty}`}><p role="status">{busy ? 'ひな形を読み込み中…' : '読み込めませんでした。権限や接続を確認し、ページを再読み込みしてください。'}</p></section> : <>
        {theme === 'v8' && <section className={styles.panel} aria-label="ひな形の分類">
          <div className={styles.actions}><Button onClick={() => setFolderFilter('all')} aria-pressed={folderFilter === 'all'}>すべて</Button><Button onClick={() => setFolderFilter('none')} aria-pressed={folderFilter === 'none'}>未分類</Button>{folders.map(folder => <Button key={folder.id} onClick={() => setFolderFilter(folder.id)} aria-pressed={folderFilter === folder.id}>{folder.name}</Button>)}</div>
          {folderLoadFailed ? <p role="alert">分類を読み込めませんでした。ページを再読み込みしてください。</p> : <div className={styles.actions}><input aria-label="分類の名前" className={styles.input} value={folderName} maxLength={100} disabled={busy} onChange={e => setFolderName(e.target.value)} /><Button disabled={busy || !folderName.trim()} onClick={() => void perform(async () => { await hqTemplatesApi.folders.create(folderName.trim()); setFolders(await hqTemplatesApi.folders.list()); setFolderName('') })}>分類を追加</Button>{folders.some(f => f.id === folderFilter) && <><Button disabled={busy || !folderName.trim()} onClick={() => void perform(async () => { const folder = folders.find(f => f.id === folderFilter)!; await hqTemplatesApi.folders.update(folder.id, folderName.trim(), folder.revision); setFolders(await hqTemplatesApi.folders.list()); setFolderName('') })}>分類の名前を変更</Button><Button disabled={busy} onClick={() => void perform(async () => { const folder = folders.find(f => f.id === folderFilter)!; await hqTemplatesApi.folders.remove(folder.id, folder.revision); setFolders(await hqTemplatesApi.folders.list()); setTemplates(await hqTemplatesApi.list(type)); setFolderFilter('all'); setMessage('分類を外しました。ひな形は未分類に残ります。') })}>分類を外す</Button></>}</div>}
        </section>}
        <div className={styles.toolbar}><input aria-label="ひな形を検索" className={`${styles.input} ${styles.search}`} placeholder="ひな形を探す" value={search} onChange={e => setSearch(e.target.value)} /><span>{templates.length}件</span></div>
        <div className={styles.panel}><table className={styles.table}><thead><tr><Th style={{ width: '28%' }}>名前</Th><Th className={styles.optional}>参照先</Th><Th className={styles.optional}>更新日時</Th><Th>配布先</Th><Th style={{ width: '12%' }}>操作</Th></tr></thead><tbody>{templates.filter(row => row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (theme !== 'v8' || folderFilter === 'all' || (row.folder_id ?? 'none') === folderFilter)).map(row => <tr key={row.id}><td data-label="名前"><span className={styles.name} title={row.name}>{row.name}</span><small className={styles.muted}>{LABELS[row.template_type]}</small></td><td data-label="参照先" className={styles.optional}><span className={styles.name} title={row.reference_summary}>{row.reference_summary ?? '—'}</span></td><td data-label="更新日時" className={styles.optional}>{formatDate(row.updated_at)}</td><td data-label="配布先">{row.distributed_account_count === undefined ? '—' : row.distributed_account_count ? `${row.distributed_account_count}アカウント` : 'まだ配っていない'}</td><td data-label="操作"><TemplateRowMenu name={row.name} busy={busy} onEdit={() => open(row.id, 'edit')} onDistribute={() => open(row.id, 'accounts')} onDuplicate={theme === 'v8' ? () => void perform(async () => { const key = `${row.id}:${row.revision}`; const requestId = duplicateAttempts.current.get(key) ?? crypto.randomUUID(); duplicateAttempts.current.set(key, requestId); await hqTemplatesApi.duplicate(row.id, `${row.name}のコピー`, row.revision, requestId); duplicateAttempts.current.delete(key); setTemplates(await hqTemplatesApi.list(type)); setMessage('ひな形を複製しました。') }) : undefined} onRemove={() => setRemove(row)} /></td></tr>)}</tbody></table>{!templates.some(row => row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (theme !== 'v8' || folderFilter === 'all' || (row.folder_id ?? 'none') === folderFilter)) && <p className={styles.empty}>{templates.length ? '検索に一致するひな形はありません。' : 'まだひな形がありません。最初のひな形を作成してください。'}</p>}</div>
        <p className={styles.muted}>配ったあとに直すと、各アカウントへは新しい版として届きます（配布先の版で確かめられます）。</p>
      </>}
    </>}
    {stage === 'edit' && theme === 'v8' && type === 'template' && 'template' in definition && <>
      {/* 板 X4JcOf（V8だけ）：絵の「ひな形の中身＋右に LINE の見え方＋一段のひな形を保存」。保存する中身は今の口のまま。 */}
      <label className={styles.field}><span>分類フォルダ</span><select aria-label="分類フォルダ" className={styles.input} value={folderId ?? ''} disabled={busy || createUncertain || folderLoadFailed} onChange={e => setFolderId(e.target.value || null)}><option value="">未分類</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <TemplateMessageFormV8
        key={formKey}
        name={name}
        onNameChange={setName}
        value={definition}
        onChange={setDefinition}
        disabled={busy || createUncertain}
        busy={busy}
        validation={validation}
        createUncertain={createUncertain}
        catalogFailed={catalogFailed}
        onReloadCatalog={reloadCatalog}
        onBusyChange={setUploadBusy}
        onReceipt={noteSessionUpload}
        onSave={() => save(false)}
      />
    </>}
    {stage === 'edit' && !(theme === 'v8' && type === 'template') && <>
      {/* 正規エディタ（タグ/回答フォーム）は右asideを持たないため、空の260px段を残さない。谷間帯（1280〜1400px）で入力欄が潰れるのを防ぐ。 */}
      <div className={canonicalEditorOwnsSave ? styles.stack : styles.grid}><div className={styles.stack}><section className={styles.panel}>
        {theme === 'v8' && <label className={styles.field}><span>分類フォルダ</span><select aria-label="分類フォルダ" className={styles.input} value={folderId ?? ''} disabled={busy || createUncertain || folderLoadFailed} onChange={e => setFolderId(e.target.value || null)}><option value="">未分類</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
        {catalogFailed ? (
          <Notice
            tone="warn"
            message="参照先の候補を読み込めませんでした。タグ・テンプレート・回答フォームは選べません。"
            action={<Button onClick={reloadCatalog}>もう一度読み込む</Button>}
          />
        ) : null}
        {!canonicalEditorOwnsSave && (!useCanonicalEditors || type !== 'rich_menu') && <>
          <label className={styles.field}><span>種類</span><input className={styles.input} value={LABELS[type]} readOnly /></label>
          <label className={styles.field}><span>名前</span><input className={styles.input} value={name} maxLength={200} disabled={busy || createUncertain} onChange={e => setName(e.target.value)} /></label>
          <label className={styles.field}><span>説明</span><textarea className={styles.input} value={description} maxLength={2000} rows={2} disabled={busy || createUncertain} onChange={e => setDescription(e.target.value)} /></label>
        </>}
        {canonicalEditorOwnsSave && createUncertain ? <>
          <Notice tone="warn" message="前回の保存結果がまだ確定していません。重複を防ぐため入力を固定しています。同じ依頼を再確認し、保存済みならその結果を読み込みます。" />
          <div className={styles.footer}><Button variant="primary" disabled={busy} onClick={() => save(false)}>前回の保存を再確認</Button></div>
        </> : <TemplateDefinitionEditor
          key={formKey}
          type={type}
          value={definition}
          disabled={busy || createUncertain}
          editing={Boolean(detail)}
          tenantId={creationScope.current?.tenantId}
          onChange={setDefinition}
          onBusyChange={setUploadBusy}
          onMediaUploaded={noteSessionUpload}
          onCanonicalCancel={useCanonicalEditors ? toList : undefined}
          onCanonicalSave={useCanonicalEditors ? saveCanonicalDefinition : undefined}
          onRichMenuNameChange={setName}
          richMenuReferences={{
            tags: referenceOptions('tag'),
            templates: referenceOptions('template'),
            forms: referenceOptions('form'),
          }}
          formReferences={{
            tags: referenceOptions('tag'),
            friendFields: [], scenarios: [], reminders: [], templates: [],
          }}
        />}
      </section></div>{!canonicalEditorOwnsSave && <aside className={styles.stack}><section className={styles.panel}><h2>保存状態</h2><p>{detail ? name !== detail.template.name || description !== (detail.template.description ?? '') || JSON.stringify(definition) !== JSON.stringify(detail.definition) ? '未保存の変更あり' : '保存済み' : '下書き'}</p>{detail && <p className={styles.muted}>{formatDate(detail.template.updated_at)}</p>}</section><section className={styles.panel}><h2>アカウントでの見え方</h2><span className={`${styles.badge} ${styles.success}`}>{name || `${LABELS[type]}名`}</span><p className={styles.muted}>参照先 {referenceCount(type, definition)}件を含めて配布します。</p></section></aside>}</div>
      {createUncertain && !canonicalEditorOwnsSave && <Notice tone="warn" message="前回の保存結果がまだ確定していません。重複を防ぐため入力を固定しています。同じ依頼を再確認し、保存済みならその結果を読み込みます。" />}
      {!canonicalEditorOwnsSave && <footer className={styles.footer}><Button disabled={busy || createUncertain} onClick={toList}>キャンセル</Button>{createUncertain ? <Button variant="primary" disabled={busy} onClick={() => save(false)}>前回の保存を再確認</Button> : <><Button disabled={busy || Boolean(validation)} onClick={() => save(false)}>下書きを保存する</Button><Button variant="primary" disabled={busy || Boolean(validation)} onClick={() => save(true)}>保存して配布先を選ぶ</Button></>}</footer>}
    </>}
    {stage === 'accounts' && <>
      <div className={styles.grid}><section className={styles.panel}><div className={styles.toolbar}><input aria-label="アカウントを検索" className={`${styles.input} ${styles.search}`} placeholder="アカウント名で検索" value={search} onChange={e => setSearch(e.target.value)} /><Checkbox disabled={busy || !shownAccounts.length} checked={!!shownAccounts.length && shownAccounts.every(a => selected.includes(a.id))} onCheckedChange={(checked) => setSelected(current => checked ? [...new Set([...current, ...shownAccounts.map(a => a.id)])] : current.filter(id => !shownAccounts.some(a => a.id === id)))}>表示中をすべて選択</Checkbox></div>
        {shownAccounts.map(account => <div key={account.id} className={styles.account}><Checkbox aria-label={account.name} checked={selected.includes(account.id)} disabled={busy} onCheckedChange={(checked) => setSelected(current => checked ? [...current, account.id] : current.filter(id => id !== account.id))}>{account.name}</Checkbox><Button disabled={busy} onClick={() => checkStores([account.id])}>{account.name}だけに配布</Button>{theme==='v8' && type==='template' && 'template' in definition && definition.template.messageType==='text' && <label className={styles.field}>{account.name}に配る本文<textarea aria-label={`${account.name}に配る本文`} className={styles.textarea} disabled={busy} maxLength={5000} value={textOverrides[account.id] ?? definition.template.messageContent} onChange={e=>setTextOverrides(current=>({...current,[account.id]:e.target.value}))}/></label>}</div>)}{!shownAccounts.length && <p className={styles.empty}>選択できるアカウントがありません。</p>}
      </section><aside className={styles.stack}><section className={styles.panel}><h2>配布するひな形</h2><p>{detail?.template.name}</p><p className={styles.muted}>参照先 {referenceCount(type, definition)}件を含む</p></section><section className={`${styles.panel} ${styles.success}`}><h2>選択済み</h2><strong className={styles.selection}>{selected.length}アカウント</strong><p>{selected.map(accountName).join('・')}</p></section><p className={styles.notice}>次に重複を確認します。既存の同名項目はアカウントごとに上書き・別名を選べます。</p></aside></div>
      <footer className={styles.footer}><Button disabled={busy} onClick={toList}>戻る</Button><Button aria-label={`${selected.length}アカウントの重複を確認`} variant="primary" disabled={busy || !selected.length} onClick={() => checkStores(selected)}>{selected.length === 1 ? '選択した1アカウントへ配布' : `選択した${selected.length}アカウントへ一括配布`}</Button></footer>
    </>}
    {stage === 'duplicates' && preflight && <>
      <p className={styles.notice}>参照先の重複も含みます。「既存を使用」は内容を変更せず、選んだ版の参照先を使います。上書きできない項目は「別名で作成」を選んでください。</p>
      <div className={styles.toolbar}><div><strong>一括設定</strong><p className={styles.muted}>個別設定で変更できます</p></div><div className={styles.actions}><Button disabled={busy} onClick={() => bulk('overwrite')}>上書き・再利用を一括指定</Button><Button disabled={busy} variant="primary" onClick={() => bulk('alias')}>すべて別名で作る</Button></div></div>
      {preflight.stores.some(s=>s.textOverride!==undefined) && <section className={styles.panel}><h2>配り先ごとの本文</h2>{preflight.stores.filter(s=>s.textOverride!==undefined).map(s=><div key={s.accountId}><strong>{s.accountName}</strong><p style={{whiteSpace:'pre-wrap'}}>{s.textOverride}</p></div>)}</section>}
      <section className={styles.panel}><table className={styles.table}><thead><tr><Th>アカウント</Th><Th>項目</Th><Th className={styles.optional}>配布先の版</Th><Th>配布方法</Th></tr></thead><tbody>{preflight.stores.flatMap(store => store.items.map(item => <tr key={choiceKey(store.accountId, item.sourceId)}><td data-label="アカウント"><span className={styles.name} title={store.accountName}>{store.accountName}</span></td><td data-label="項目"><span className={styles.name} title={item.name}>{item.name}</span><span className={styles.muted}>{item.itemKind === 'folder' ? 'タググループ' : item.itemKind === 'rich_menu' ? 'リッチメニュー' : item.itemKind === 'form' ? '回答フォーム' : item.itemKind === 'media' ? '登録メディア' : item.itemKind === 'template' ? 'テンプレート' : item.itemKind}</span></td><td data-label="配布先の版" className={styles.optional}>{item.expectedRevision ?? '新規'}</td><td data-label="配布方法">{item.duplicate ? <div role="group" aria-label={`${store.accountName} ${item.name}の配布方法`} className={styles.actions}>{(item.operation === 'reuse' ? ['overwrite'] as const : ['overwrite', 'alias'] as const).map(mode => <Button key={mode} disabled={busy || !item.allowedModes.includes(mode)} variant={choices[choiceKey(store.accountId, item.sourceId)] === mode ? 'primary' : 'secondary'} aria-pressed={choices[choiceKey(store.accountId, item.sourceId)] === mode} onClick={() => setChoices(current => ({ ...current, [choiceKey(store.accountId, item.sourceId)]: mode }))}>{item.operation === 'reuse' && mode === 'overwrite' ? '既存を使用' : MODES[mode]}</Button>)}</div> : '新規作成'}</td></tr>))}</tbody></table></section>
      <p className={`${styles.notice} ${styles.error}`}>配布直前に版を再確認します。配布先で編集があれば、そのアカウントの変更を取り消します。</p>
      {expired && <p role="alert">確認の有効期限が切れました。アカウントの現在版をもう一度確認してください。</p>}
      <p className={styles.muted}>成功済みアカウントは保持され、失敗分だけ再確認できます。別名はアカウント内で重複しない名前になります。</p>
      <footer className={styles.footer}><Button disabled={busy} onClick={() => { setPreflight(null); setStage('accounts') }}>戻る</Button>{expired && <Button disabled={busy} onClick={() => checkStores(selected)}>現在版を再確認</Button>}<Button variant="primary" disabled={busy || expired || !resolutions || !!pendingRun} onClick={run}>この内容で{preflight.stores.length}アカウントへ配布</Button></footer>
    </>}
    {stage === 'result' && <div data-design-node="dEvJM">
      <div className={styles.toolbar}><p className={styles.muted}>配布番号：{pendingRun}</p><Button disabled={busy} onClick={refreshResult}>結果を再確認</Button></div>
      {!result ? (theme === 'v8' ? (
        <section className={`${styles.panel} ${styles.progress}`} aria-label="配布の進み具合">
          <h2>配布の進み具合</h2>
          <div className={styles.progressTrack} aria-hidden="true"><span className={styles.progressFill} /></div>
          <p role="status" className={styles.muted}>配布番号：{pendingRun} の結果を確認しています。確認できるまでは再配布しません。</p>
        </section>
      ) : (
        <p className={`${styles.panel} ${styles.empty}`} role="status">結果を確認中です。確認できるまでは再配布しません。</p>
      )) : <>
        <div className={styles.metrics}>{[['成功', `${successes.length}アカウント`], ['失敗', `${failures.length}アカウント`], ['新規作成', `${totals.created}件`], ['上書き', `${totals.overwritten}件`], ['別名作成', `${totals.aliased}件`]].map(([label, value]) => <section key={label} className={styles.panel}><span>{label}</span><strong>{value}</strong></section>)}</div>
        <div className={styles.grid}><div className={styles.stack}>{result.stores.map(store => <section key={store.accountId} className={`${styles.panel} ${failures.includes(store) ? styles.failed : ''}`}><div className={styles.toolbar}><h2>{store.accountName ?? accountName(store.accountId)}</h2><span className={styles.badge}>{store.status === 'succeeded' ? '成功' : failures.includes(store) ? '失敗' : '確認中'}</span></div>
          {store.status === 'succeeded' ? <p>新規 {store.counts.created}件　上書き {store.counts.overwritten}件　別名 {store.counts.aliased}件{Boolean(store.counts.reused) && <>　既存参照 {store.counts.reused}件を再利用</>}</p> : failures.includes(store) ? <><p>このアカウントの変更は取り消しました</p><p className={`${styles.notice} ${styles.error}`}>{store.reason || '配布できませんでした。アカウントの現在版を再確認してください。'}</p>{store.cleanupPending && <p className={styles.notice}>画像の後片付けを自動で再試行中です。「結果を再確認」で状態を更新できます。</p>}{done && <div className={styles.footer}><Button variant="primary" disabled={busy} onClick={() => { checkStores([store.accountId]) }}>このアカウントだけ再確認して配布</Button></div>}</> : <p>まだ処理の完了を確認できていません。</p>}
        </section>)}</div><aside className={styles.panel}><h2>再実行の動作</h2><p>成功アカウントは再送せず、失敗アカウントの現在版を取得して重複確認へ戻ります。</p></aside></div>
      </>}
      <footer className={styles.footer}><Button disabled={busy} onClick={toList}>ひな形一覧へ</Button>{done && failures.length > 0 && <Button variant="primary" disabled={busy} onClick={() => { checkStores(failures.map(s => s.accountId)) }}>失敗{failures.length}アカウントを再確認</Button>}</footer>
    </div>}
    <ConfirmDialog open={!!remove} title="ひな形を削除" description={`「${remove?.name ?? ''}」を削除します。配布済みのアカウントデータは残ります。`} destructive confirmLabel="削除する" busy={busy} onCancel={() => { if (!busy) setRemove(null) }} onConfirm={() => void perform(async () => { if (!remove) return; await hqTemplatesApi.remove(remove.id, remove.revision); setTemplates(current => current.filter(t => t.id !== remove.id)); setRemove(null); setMessage('ひな形を削除しました。') })} />
  </div>
}
