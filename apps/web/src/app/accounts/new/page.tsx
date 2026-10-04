'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useAdminTheme } from '@/lib/use-admin-theme'
import type { LineAccountTagSummary, StaffMember } from '@line-crm/shared'
import Image from 'next/image'
import { api, type FollowerImportState, type LineAccountConnectData } from '@/lib/api'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import Button from '@/components/shared/button'
import RadioCard from '@/components/shared/radio-card'
import { RequiredBadge } from '@/components/shared/form-controls'
import PageHeader from '@/components/shared/page-header'
import StickyBar from '@/components/shared/sticky-bar'
import StatusBadge from '@/components/shared/status-badge'
import Notice from '@/components/shared/notice'
import NoticeLineRegisterDialog from '@/components/hq/notice-line-register-dialog'
import { CHECK_STATE_LABEL, canSave, stoppedAt, toSteps } from '../connection-check-view'
import { isDuplicateChannelError, matchRegisteredAccountId } from './account-recovery'

const WIZARD_STEPS = [
  { number: 1, label: '基本情報', designNode: 'a8qMXX' },
  { number: 2, label: 'LINE準備', designNode: 'oeVQQ' },
  { number: 3, label: 'チャネル設定', designNode: 'YEHCR' },
  { number: 4, label: '接続確認', designNode: 'K1zHyx' },
  { number: 5, label: '完了', designNode: 'VPh1U' },
] as const

type StepNumber = (typeof WIZARD_STEPS)[number]['number']
type BusyAction = 'check' | 'save' | null
type FieldErrors = Record<string, string>
type FormState = {
  name: string
  channelId: string
  channelSecret: string
  loginChannelId: string
  loginChannelSecret: string
}

const emptyForm: FormState = {
  name: '', channelId: '', channelSecret: '', loginChannelId: '', loginChannelSecret: '',
}

export default function NewLineAccountPage() {
  const theme=useAdminTheme()
  const [tagIds,setTagIds]=useState<string[]>([]), [staffIds,setStaffIds]=useState<string[]>([])
  const [parentId,setParentId]=useState(''), [liffId,setLiffId]=useState('')
  const [options,setOptions]=useState<{tags:LineAccountTagSummary[];parents:{id:string;name:string}[];staff:StaffMember[]}>({tags:[],parents:[],staff:[]})
  const [optionsState,setOptionsState]=useState<'loading'|'ready'|'failed'>('loading')
  useEffect(()=>{
    if(theme!=='v8') return
    let active=true
    void Promise.all([api.lineAccountTags.list(),api.lineAccounts.list(),api.staff.list()]).then(([tags,accounts,staff])=>{
      if(!tags.success || !accounts.success || !staff.success) throw new Error('候補取得失敗')
      if(active){setOptions({tags:tags.data,parents:accounts.data.filter(a=>a.isActive&&!a.archivedAt).map(a=>({id:a.id,name:a.name})),staff:staff.data.filter(s=>s.isActive&&s.accountScope==='accounts'&&s.inviteStatus==='active')});setOptionsState('ready')}
    }).catch(()=>{if(active)setOptionsState('failed')})
    return ()=>{active=false}
  },[theme])
  const [accountMethod, setAccountMethod] = useState<'existing' | 'new'>('existing')
  const [currentStep, setCurrentStep] = useState<StepNumber>(1)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [connection, setConnection] = useState<LineAccountConnectData | null>(null)
  const [importState, setImportState] = useState<FollowerImportState | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState('')
  // R523: 応答消失・重複で見つけた登録済みアカウント。詳細へ復帰するために持つ。
  const [recoveredAccountId, setRecoveredAccountId] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const busyLock = useRef(false)
  const stepPanelRef = useRef<HTMLDivElement>(null)

  const steps = useMemo(() => toSteps(connection ? { steps: connection.steps } : null), [connection])
  const stopped = stoppedAt(steps)
  const connectionPassed = Boolean(connection && canSave(steps))
  const createdId = connection?.id ?? ''
  const workerBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const callbackUrl = workerBase ? `${workerBase}/auth/callback` : '—'
  const importingIds = (importState?.phase ?? connection?.followerImport.phase) === 'importing_ids'
  // 登録完了（取り込みも終わった）直後に、契約者専用LINEの登録案内を一度だけ出す（決定 2026-09-18）
  const [noticeDialog, setNoticeDialog] = useState<'idle' | 'open' | 'done'>('idle')
  useEffect(() => {
    if (currentStep === 5 && connection && !importingIds && noticeDialog === 'idle') setNoticeDialog('open')
  }, [currentStep, connection, importingIds, noticeDialog])

  useEffect(() => { stepPanelRef.current?.focus() }, [currentStep])

  useEffect(() => {
    if (!createdId || !['importing_ids','hydrating_profiles'].includes(importState?.phase ?? connection?.followerImport.phase ?? '')) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const advance = async () => {
      try {
        const response = await api.lineAccounts.followerImportState(createdId)
        if (!active || !response.success) return
        setImportState(response.data)
        if (['importing_ids','hydrating_profiles'].includes(response.data.phase)) {
          timer = setTimeout(() => void advance(), 3000)
        }
      } catch {
        if (active) timer = setTimeout(() => void advance(), 5000)
      }
    }
    void advance()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [createdId, importState?.phase, connection?.followerImport.phase])

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setConnection(null)
    setError('')
    setRecoveredAccountId('')
  }

  const validateStep = (step: StepNumber) => {
    const nextErrors = getStepErrors(step, form)
    setFieldErrors((current) => ({ ...current, ...nextErrors }))
    return Object.keys(nextErrors).length === 0
  }

  const moveNext = () => {
    if(theme==='v8' && currentStep===1 && optionsState!=='ready') {setError('タグ・親・担当者の候補を読み込んでから進めてください。');return}
    if (currentStep <= 3 && !validateStep(currentStep)) {
      setError('入力内容を確認してください。')
      return
    }
    setError('')
    if (currentStep < 4) setCurrentStep((currentStep + 1) as StepNumber)
  }

  const input = () => ({
    name: form.name.trim() || undefined,
    channelId: form.channelId.trim(),
    channelSecret: form.channelSecret,
    loginChannelId: form.loginChannelId.trim(),
    loginChannelSecret: form.loginChannelSecret,
    ...(theme==='v8'?{tagIds,staffIds,parentLineAccountId:parentId||null,...(liffId.trim()?{liffId:liffId.trim()}: {})}: {}),
  })

  const checkConnection = async () => {
    const nextErrors = getStepErrors(3, form)
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...nextErrors }))
      setCurrentStep(3)
      setError('接続に必要な4項目を確認してください。')
      return
    }
    if (busyLock.current) return
    busyLock.current = true
    setBusyAction('check')
    setConnection(null)
    setError('')
    try {
      const response = await api.lineAccounts.connectCheck(input())
      if (!response.success) {
        setError(response.error)
        return
      }
      setConnection(response.data)
      if (!canSave(response.data.steps)) {
        setError('止まった項目を直して、もう一度「接続して設定する」を押してください。')
      }
    } catch {
      setError('LINEに接続できませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  /*
   * R523: 同じチャネルIDで作られた行が残っていないか照合する。
   * 取れなければ null（未保存と断定しない）。一覧が読めない試験環境でも落ちない。
   */
  const findRegisteredAccountId = async (channelId: string): Promise<string | null> => {
    try {
      const list = await api.lineAccounts.list()
      if (!list.success) return null
      return matchRegisteredAccountId(list.data, channelId)
    } catch {
      return null
    }
  }

  const save = async (stepUpToken?: string) => {
    if (!connectionPassed || busyLock.current) {
      setError('5段すべて通ってから保存してください。')
      return
    }
    busyLock.current = true
    setBusyAction('save')
    setError('')
    setRecoveredAccountId('')
    try {
      const response = await api.lineAccounts.connect(input(), stepUpToken)
      if (!response.success) {
        // R523: 重複（同じ情報での再試行で行き止まり）は登録済みの詳細へ案内する。
        if (isDuplicateChannelError(response.error)) {
          const recovered = await findRegisteredAccountId(form.channelId)
          if (recovered) {
            setRecoveredAccountId(recovered)
            setError('このチャネルIDは登録済みです。登録済みのアカウントを開いて確認してください。')
            return
          }
        }
        setError(response.error)
        return
      }
      setConnection(response.data)
      setForm((current) => ({ ...current, channelSecret: '', loginChannelSecret: '' }))
      setCurrentStep(5)
    } catch (caught) {
      // LINEの接続は大事な操作。本人確認を求められたら窓を立ててやり直す（V-1）。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'line_account.connect', action: 'LINEの接続を登録する', retry: save })
        return
      }
      // R523: 応答が無い失敗は「未保存」と断定しない。作られた行が残っていることがある。
      const recovered = await findRegisteredAccountId(form.channelId)
      if (recovered) {
        setRecoveredAccountId(recovered)
        setError('保存は終わっている可能性があります。登録済みのアカウントを開いて確認してください。')
        return
      }
      setError('登録できませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (currentStep === 4) void save()
    else moveNext()
  }

  const review = (
    <div className="space-y-4">
      <ReviewGroup title="基本情報"><ReviewRow label="表示名" value={form.name.trim() || 'LINEから取得'} /></ReviewGroup>
      <ReviewGroup title="Messaging API"><ReviewRow label="チャネルID" value={form.channelId.trim()} /><SecretReviewRow label="チャネルシークレット" /></ReviewGroup>
      <ReviewGroup title="LINE Login"><ReviewRow label="LoginチャネルID" value={form.loginChannelId.trim()} /><SecretReviewRow label="Loginチャネルシークレット" /></ReviewGroup>
    </div>
  )

  return (
    <div data-design-node="b2NGxk" className="flex w-full flex-col gap-4 pb-24">
      {/* ★V7: 登録専用の枠の幅いっぱいに広げる。中央寄せの狭い列にしない。 */}
      <div data-design="Head">
        <div className="flex justify-end"><Button href="/hq">統括コンソールへ戻る</Button></div>
        <PageHeader
          breadcrumb={[{ label: 'LINEアカウント', href: '/accounts' }, { label: '登録' }]}
          title="LINEアカウントを登録"
          description="4つのチャネル情報を入力すると、接続設定と既存友だちの取り込みを自動で行います。"
        />
      </div>

      {/*
        U050: スマホで全5手順のカードが縦に積まれ、最初の入力欄まで
        長かった。狭い画面では「いまの手順＋位置」だけを出し、全手順は
        開いて確認する形にする。640px 以上ではこれまでどおり5段で出す。
      */}
      <nav data-design="Steps" aria-label="登録の進捗" className="bg-canvas rounded-card border-hairline border p-4">
        <ol className="hidden gap-2 sm:grid sm:grid-cols-5">
          {WIZARD_STEPS.map((step) => {
            const active = currentStep === step.number
            const complete = currentStep > step.number || Boolean(createdId)
            return <li key={step.number} aria-current={active ? 'step' : undefined} className={`rounded-control border px-3 py-2 ${active ? 'border-action bg-action-soft' : 'border-hairline'}`}>
              <span className="text-ink-faint block text-xs">手順 {step.number} / 5</span>
              <span className="text-ink mt-0.5 block text-xs font-medium">{step.label}{complete ? '（完了）' : ''}</span>
            </li>
          })}
        </ol>
        <details className="sm:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span>
              <span className="text-ink-faint block text-xs">手順 {currentStep} / 5</span>
              <span className="text-ink mt-0.5 block text-sm font-bold">{WIZARD_STEPS.find((step) => step.number === currentStep)?.label}</span>
            </span>
            <span className="text-action shrink-0 text-xs font-semibold">全手順を見る</span>
          </summary>
          <ol className="mt-3 grid gap-2">
            {WIZARD_STEPS.map((step) => {
              const active = currentStep === step.number
              const complete = currentStep > step.number || Boolean(createdId)
              return <li key={step.number} aria-current={active ? 'step' : undefined} className={`rounded-control border px-3 py-2 ${active ? 'border-action bg-action-soft' : 'border-hairline'}`}>
                <span className="text-ink-faint block text-xs">手順 {step.number} / 5</span>
                <span className="text-ink mt-0.5 block text-xs font-medium">{step.label}{complete ? '（完了）' : ''}</span>
              </li>
            })}
          </ol>
        </details>
      </nav>

      <form onSubmit={submit} noValidate aria-busy={busyAction ? true : undefined}>
        <div data-design="Body" ref={stepPanelRef} tabIndex={-1} className="outline-none">
          {currentStep === 1 && <div data-design-node={theme==='v8'?'GwKE2':'a8qMXX'}>
            <SetupSection title="1. 基本情報" description="管理画面で見分ける名前を設定します。未入力でも登録できます。">
              <Field id="account-name" label="表示名（任意）" value={form.name} onChange={(value) => update('name', value)} placeholder="未入力なら LINE公式アカウントの名前をそのまま使います" error={fieldErrors.name} />
              {theme==='v8' && <div className="space-y-4">
                {optionsState==='failed' && <p role="alert">タグ・親・担当者を読み込めませんでした。再読み込みしてください。</p>}
                {optionsState==='loading' && <p role="status">登録の候補を読み込んでいます…</p>}
                <fieldset disabled={optionsState!=='ready'}><legend>アカウントタグ</legend><div className="flex flex-wrap gap-3">{options.tags.map(tag=><label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={e=>setTagIds(current=>e.target.checked?[...current,tag.id]:current.filter(id=>id!==tag.id))}/>{tag.name}</label>)}</div>{!options.tags.length && optionsState==='ready' && <p>タグは統括のアカウント一覧から作成できます。</p>}</fieldset>
                <label className="block">親アカウント<select aria-label="親アカウント" className="mt-1 block w-full rounded-control border border-hairline p-2" disabled={optionsState!=='ready'} value={parentId} onChange={e=>setParentId(e.target.value)}><option value="">親なし</option>{options.parents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                <fieldset disabled={optionsState!=='ready'}><legend>このアカウントを担当範囲に追加する人</legend><div className="flex flex-wrap gap-3">{options.staff.map(member=><label key={member.id}><input type="checkbox" checked={staffIds.includes(member.id)} onChange={e=>setStaffIds(current=>e.target.checked?[...current,member.id]:current.filter(id=>id!==member.id))}/>{member.name}</label>)}</div><p className="text-xs text-ink-secondary">全アカウント担当者は追加操作なしで閲覧できます。</p></fieldset>
                <Field id="existing-liff-id" label="既存のLIFF ID（任意）" value={liffId} onChange={setLiffId} placeholder="未入力なら自動で用意します"/>
              </div>}
            </SetupSection>
          </div>}

          {currentStep === 2 && <div data-design-node="oeVQQ">
            <SetupSection title="2. LINE側の準備" description="登録するLINE公式アカウントの用意方法を選びます。">
              <fieldset>
                <legend className="text-ink-secondary mb-2 text-xs font-medium">アカウントの用意方法</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Choice checked={accountMethod === 'existing'} onChange={() => setAccountMethod('existing')} label="既存の公式アカウントを使う" value="existing" />
                  <Choice checked={accountMethod === 'new'} onChange={() => setAccountMethod('new')} label="新しく公式アカウントを作成" value="new" />
                </div>
              </fieldset>
              {accountMethod === 'new' && <div className="rounded-control border-hairline border p-4 text-sm">
                <p className="text-ink-secondary mb-3">LINE公式アカウントを作成してから、同じプロバイダー内にMessaging APIとLINE Loginのチャネルを用意します。</p>
                <a href="https://manager.line.biz/" target="_blank" rel="noreferrer" className="text-action font-semibold hover:underline">LINE公式アカウントを作る（LINE Official Account Manager）</a>
              </div>}
              <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className="text-action inline-block text-sm font-semibold hover:underline">LINE Developersを開く</a>
            </SetupSection>
          </div>}

          {currentStep === 3 && <div data-design-node="YEHCR" className="grid gap-4 lg:grid-cols-2">
            <SetupSection title="Messaging API" description="アクセストークンはmusuboが自動で発行します。" action={<ManualLink anchor="m1" label="取得方法を見る" />}>
              <Field id="channel-id" label="チャネルID" value={form.channelId} onChange={(value) => update('channelId', value)} inputMode="numeric" required error={fieldErrors.channelId} />
              <Field id="channel-secret" label="チャネルシークレット" value={form.channelSecret} onChange={(value) => update('channelSecret', value)} type="password" required error={fieldErrors.channelSecret} />
            </SetupSection>
            <SetupSection title="LINE Login" description="LIFFは自動で作成します。Messaging APIと同じプロバイダーのチャネルを入力してください。" action={<ManualLink anchor="m2" label="取得方法を見る" />}>
              <Field id="login-channel-id" label="LoginチャネルID" value={form.loginChannelId} onChange={(value) => update('loginChannelId', value)} inputMode="numeric" required error={fieldErrors.loginChannelId} />
              <Field id="login-channel-secret" label="Loginチャネルシークレット" value={form.loginChannelSecret} onChange={(value) => update('loginChannelSecret', value)} type="password" required error={fieldErrors.loginChannelSecret} />
            </SetupSection>
          </div>}

          {currentStep === 4 && <div data-design-node="K1zHyx" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-4">
              <SetupSection title="4. LINE側の設定" description="LINE LoginチャネルへCallback URLを登録してください。" action={<ManualLink anchor="m3" label="設定方法を見る" />}>
                <EndpointRow label="Callback URL" value={callbackUrl} help="LINE Login → Callback URL" />
              </SetupSection>
              <SetupSection title="接続確認" description="上から順に自動設定します。止まった段だけ直して再実行してください。">
                <ol className="space-y-2" aria-label="接続確認項目">
                  {steps.map((item) => <li key={item.order} className="border-hairline rounded-control flex items-start gap-3 border p-3">
                    <span className="text-ink-faint w-4 shrink-0 text-xs tabular-nums">{item.order}</span>
                    <span className="text-ink min-w-0 flex-1 text-xs leading-relaxed">{item.message}</span>
                    <StatusBadge tone={item.state === 'passed' ? 'success' : item.state === 'failed' ? 'warning' : 'neutral'}>{CHECK_STATE_LABEL[item.state]}</StatusBadge>
                  </li>)}
                </ol>
                {stopped && <Notice tone="warn" message={stopped.message} />}
                {connectionPassed && <Notice tone="success" message="5段すべて通りました。保存できます。" />}
                <Button type="button" variant="primary" disabled={Boolean(busyAction)} onClick={() => void checkConnection()} busy={busyAction === 'check'} busyLabel="接続して設定しています…">接続して設定する</Button>
              </SetupSection>
            </div>
            <aside className="space-y-4" aria-label="設定時の補足">
              <details className="rounded-card border border-hairline bg-canvas p-5"><summary className="cursor-pointer text-sm font-bold text-ink">登録内容を確認する</summary><div className="mt-4">{review}</div></details>
              <InfoSection title="つながる先"><ul className="space-y-2"><li>友だち追加URL・QR</li><li>ログインユーザーの担当範囲</li><li>運用状態の接続監視</li><li>友だち一覧</li></ul></InfoSection>
              <InfoSection title="気をつけること"><ul className="space-y-2"><li>Messaging APIとLINE Loginは同じプロバイダーで作成してください。</li><li>Webhookの利用はLINE Developersでオンにしてください。</li><li>秘密値は保存後に画面へ表示されません。</li><li>接続確認が5段すべて通るまで登録しません。</li></ul></InfoSection>
            </aside>
          </div>}

          {currentStep === 5 && connection && <div data-design-node={importingIds ? 'VPh1U' : 't3Mlu'}>
            <SetupSection title="登録が完了しました" description="LINEアカウントの接続設定を自動で完了しました。">
              {importingIds ? <Notice tone="info">認証済みアカウントのため、既存の友だちを取り込んでいます（{importState?.received ?? 0}人 / 確認中）。取り込みが終わるまで、この画面でお待ちください。</Notice> : <Notice tone="success" message="登録が完了しました" />}
              <ReviewGroup title="LINEアカウント">
                <ReviewRow label="表示名" value={`${connection.displayName ?? form.name}（LINEから取得）`} />
                <ReviewRow label="LINE ID" value={connection.basicId ?? '取得できませんでした'} />
                <ReviewRow label="認証状態" value={connection.followerImport.capability === 'available' ? '認証済み' : '未認証'} />
                <ReviewRow label="LIFF ID" value={`${connection.liffId ?? '—'}（自動作成）`} />
                <ReviewRow label="既存の友だちの取り込み" value={connection.followerImport.capability === 'available' ? `${importState?.imported ?? 0}人` : '未認証のため、友だちは操作があった順に登録されます'} />
              </ReviewGroup>
              {connection.pictureUrl && <Image src={connection.pictureUrl} alt="LINE公式アカウントのアイコン" width={64} height={64} unoptimized className="h-16 w-16 rounded-pill object-cover" />}
              {connection.remainingActions.length > 0 && <InfoSection title="残りの手作業"><ul className="space-y-2">{connection.remainingActions.map((item) => <li key={item}>{item}</li>)}</ul></InfoSection>}
            </SetupSection>
          </div>}
        </div>

        {/*
          R523: 登録済みを見つけたときは赤の失敗にせず、詳細への復帰と一緒に
          黄の注意で出す（失敗の1枚はここだけ）。
        */}
        {recoveredAccountId ? (
          <Notice
            tone="warn"
            message={error || '保存は終わっている可能性があります。登録済みのアカウントを開いて確認してください。'}
            action={<Button href={`/accounts/detail?id=${encodeURIComponent(recoveredAccountId)}`}>登録したアカウントを見る</Button>}
            onClose={() => { setError(''); setRecoveredAccountId('') }}
            className="mt-4"
          />
        ) : error ? (
          <Notice tone="danger" message={error} onClose={() => setError('')} className="mt-4" />
        ) : null}
        <NoticeLineRegisterDialog open={noticeDialog === 'open'} onClose={() => setNoticeDialog('done')} />
        {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
        <div data-design="Actions">
          <StickyBar
            status={createdId ? (importingIds ? '既存の友だちを取り込んでいます' : '登録が完了しました') : busyAction === 'save' ? '接続して保存しています' : `手順 ${currentStep} / 5`}
            actions={createdId ? <>
              {importingIds ? <><Button type="button" disabled>登録したアカウントを見る</Button><Button type="button" variant="primary" disabled>統括コンソールへ</Button></> : <><Button href={`/accounts/detail?id=${encodeURIComponent(createdId)}`}>登録したアカウントを見る</Button><Button href="/hq" variant="primary">統括コンソールへ</Button></>}
            </> : <>
              <Button href="/accounts">キャンセル</Button>
              {currentStep > 1 && <Button type="button" disabled={Boolean(busyAction)} onClick={() => { setError(''); setCurrentStep((currentStep - 1) as StepNumber) }}>戻る</Button>}
              <Button type="submit" variant="primary" disabled={Boolean(busyAction) || (currentStep === 4 && !connectionPassed)} busy={currentStep === 4 && busyAction === 'save'} busyLabel="接続して保存しています…">{currentStep === 4 ? '接続して保存する' : '次へ'}</Button>
            </>}
          />
        </div>
      </form>
    </div>
  )
}

function getStepErrors(step: StepNumber, form: FormState): FieldErrors {
  const errors: FieldErrors = {}
  if (step === 1 && form.name.trim().length > 40) errors.name = '表示名は40文字以内で入力してください。'
  if (step === 3) {
    if (!form.channelId.trim()) errors.channelId = 'チャネルIDを入力してください。'
    else if (!/^\d+$/.test(form.channelId.trim())) errors.channelId = 'チャネルIDは半角数字で入力してください。'
    if (!form.channelSecret) errors.channelSecret = 'チャネルシークレットを入力してください。'
    if (!form.loginChannelId.trim()) errors.loginChannelId = 'LoginチャネルIDを入力してください。'
    else if (!/^\d+$/.test(form.loginChannelId.trim())) errors.loginChannelId = 'LoginチャネルIDは半角数字で入力してください。'
    if (!form.loginChannelSecret) errors.loginChannelSecret = 'Loginチャネルシークレットを入力してください。'
  }
  return errors
}

function SetupSection({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return <section className="bg-canvas rounded-card border-hairline border p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-ink text-base font-bold">{title}</h2><p className="text-ink-secondary mt-1 text-xs leading-relaxed">{description}</p></div>{action}</div><div className="mt-4 space-y-4">{children}</div></section>
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="bg-canvas rounded-card border-hairline border p-5"><h3 className="text-ink text-sm font-bold">{title}</h3><div className="text-ink-secondary mt-3 text-xs leading-relaxed">{children}</div></section>
}

function ManualLink({ anchor, label }: { anchor: 'm1' | 'm2' | 'm3'; label: string }) {
  return <a href={`/manuals/line-connect/index.html#${anchor}`} target="_blank" rel="noreferrer" className="text-action shrink-0 text-xs font-semibold hover:underline">{label}</a>
}

function Choice({ checked, onChange, label, value }: { checked: boolean; onChange: () => void; label: string; value: string }) {
  return <RadioCard name="account-method" value={value} checked={checked} onChange={onChange} title={label} />
}

function Field({ id, label, value, onChange, placeholder, required = false, type = 'text', inputMode, error }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean; type?: 'text' | 'password'; inputMode?: 'text' | 'numeric'; error?: string }) {
  const errorId = `${id}-error`
  return <label className="block" htmlFor={id}><span className="text-ink-secondary mb-1 block text-xs font-medium">{label}{required && <RequiredBadge />}</span><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} inputMode={inputMode} autoComplete={type === 'password' ? 'new-password' : undefined} spellCheck={type === 'password' ? false : undefined} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className="border-hairline rounded-control text-ink w-full border px-3 py-2 text-sm" />{error && <span id={errorId} className="text-danger mt-1 block text-xs">{error}</span>}</label>
}

function EndpointRow({ label, value, help }: { label: string; value: string; help: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { if (value === '—') return; try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1200) } catch { /* 表示値を選択してコピーできる。 */ } }
  return <div><p className="text-ink-faint text-xs font-medium">{label}</p><div className="mt-1 flex items-stretch gap-2"><p className="bg-canvas-sunken rounded-control text-ink min-w-0 flex-1 select-all break-all px-3 py-2 text-xs leading-relaxed">{value}</p><Button type="button" onClick={() => void copy()} disabled={value === '—'} className="shrink-0">{copied ? 'コピー済み' : 'コピー'}</Button></div><p className="text-ink-faint mt-1 text-xs">{help}</p></div>
}

function ReviewGroup({ title, children }: { title: string; children: ReactNode }) { return <section className="border-hairline rounded-control border p-4"><h3 className="text-ink text-sm font-bold">{title}</h3><dl className="mt-3 divide-y divide-hairline">{children}</dl></section> }
function ReviewRow({ label, value }: { label: string; value: string }) { return <div className="grid gap-1 py-2 sm:grid-cols-3"><dt className="text-ink-faint text-xs">{label}</dt><dd className="text-ink break-all text-sm sm:col-span-2">{value}</dd></div> }
function SecretReviewRow({ label }: { label: string }) { return <ReviewRow label={label} value="入力済み（安全のため表示しません）" /> }
