'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState, type ReactNode } from 'react'
import { useAccount } from '@/contexts/account-context'
import { MANUAL_LINKS } from '@/lib/manual-links'
import { restaurantTestApi } from '@/lib/restaurant-test-api'

type Step = 'choose' | 'create' | 'api' | 'credentials' | 'verify' | 'done'
type Choice = 'existing' | 'new' | null
type Connected = Awaited<ReturnType<typeof restaurantTestApi.connectStore>>['data']

const validSteps: Step[] = ['choose', 'create', 'api', 'credentials', 'verify', 'done']

function ManualLink({ href, children }: { href: string; children: ReactNode }) {
  if (!href) return <span aria-disabled="true" className="inline-flex cursor-not-allowed rounded-control border border-hairline bg-canvas-sunken px-4 py-2 text-sm font-semibold text-ink-faint">マニュアルは準備中です</span>
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex rounded-control border border-action px-4 py-2 text-sm font-semibold text-action outline-none focus-visible:ring-2 focus-visible:ring-action">{children}</a>
}

function Field({ label, help, error, children }: { label: string; help: string; error?: string; children: ReactNode }) {
  return <div><div className="mb-2 flex items-center gap-2"><label className="text-sm font-semibold text-ink">{label}</label><span className="rounded-pill bg-danger-bg px-2 py-1 text-xs font-semibold text-danger">必須</span></div>{children}<p className="mt-2 text-xs leading-5 text-ink-secondary">{help}</p>{error ? <p role="alert" className="mt-1 text-xs font-semibold text-danger">{error}</p> : null}</div>
}

const buttonClass = 'rounded-control px-5 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:opacity-40'

export default function NewStorePage() {
  return <Suspense fallback={<div className="min-h-screen bg-shell" />}><NewStoreFlow /></Suspense>
}

function NewStoreFlow() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId } = useAccount()
  const requested = searchParams.get('step') as Step | null
  const step = requested && validSteps.includes(requested) ? requested : 'choose'
  const [choice, setChoice] = useState<Choice>(null)
  const [createdOfficial, setCreatedOfficial] = useState(false)
  const [apiEnabled, setApiEnabled] = useState(false)
  const [channelId, setChannelId] = useState('')
  const [channelSecret, setChannelSecret] = useState('')
  const [alias, setAlias] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [connected, setConnected] = useState<Connected | null>(null)

  const move = (next: Step) => router.replace(`/stores/new?step=${next}`)
  const progress = step === 'done' ? 3 : step === 'verify' ? 2 : 1
  const next = () => {
    if (step === 'choose' && choice) move(choice === 'new' ? 'create' : 'api')
    if (step === 'create' && createdOfficial) move('api')
    if (step === 'api' && apiEnabled) move('credentials')
    if (step === 'credentials') {
      const nextErrors: Record<string, string> = {}
      if (!channelId.trim()) nextErrors.channelId = 'チャネルIDを入力してください。'
      if (!channelSecret.trim()) nextErrors.channelSecret = 'チャネルシークレットを入力してください。'
      setErrors(nextErrors)
      if (!Object.keys(nextErrors).length) move('verify')
    }
  }
  const back = () => {
    if (step === 'create') move('choose')
    if (step === 'api') move(choice === 'new' ? 'create' : 'choose')
    if (step === 'credentials') move('api')
    if (step === 'verify') move('credentials')
  }
  const connect = async () => {
    if (!alias.trim()) { setErrors({ alias: 'この店舗の呼び名を入力してください。' }); return }
    setSaving(true); setErrors({})
    try {
      const response = await restaurantTestApi.connectStore(selectedAccountId, { name: alias.trim(), alias: alias.trim(), channelId: channelId.trim(), channelSecret: channelSecret.trim() })
      setConnected(response.data); setChannelSecret('')
    } catch (error) {
      setErrors({ alias: error instanceof Error ? error.message : '接続を確認できませんでした。入力内容を確認してください。' })
    } finally { setSaving(false) }
  }

  return <div className="min-h-screen bg-shell pb-28 text-ink">
    <header className="flex min-h-16 items-center justify-between border-b border-hairline bg-canvas px-6"><div className="flex items-center gap-4"><strong className="text-xl text-accent">musubo</strong><span className="h-5 w-px bg-hairline" /><span className="text-sm font-semibold">店舗アカウントの追加</span></div><button type="button" onClick={() => router.replace('/hq')} className="rounded-control px-3 py-2 text-sm font-semibold text-action outline-none focus-visible:ring-2 focus-visible:ring-action">保存して中断</button></header>
    <nav aria-label="進行状況" className="border-b border-hairline bg-canvas"><ol className="mx-auto grid max-w-5xl grid-cols-3 px-6">{['公式LINE', '接続の確認', '完了'].map((label, index) => <li key={label} className={`border-b-2 py-4 text-center text-sm font-semibold ${index + 1 <= progress ? 'border-accent text-ink' : 'border-transparent text-ink-faint'}`}>{index + 1 < progress ? '✓ ' : ''}{label}</li>)}</ol></nav>
    <main className="mx-auto max-w-5xl px-6 py-12">
      {step === 'choose' ? <section><h1 className="text-3xl font-bold">公式LINEの選び方</h1><p className="mt-3 text-ink-secondary">店舗で使うLINE公式アカウントを選んでください。</p><div className="mt-8 grid gap-5 md:grid-cols-2">{([['existing','すでに使っている公式LINEをつなぐ','今お使いのアカウントをmusuboへ接続します。'],['new','新しく公式LINEを作る','店舗専用のアカウントを新しく用意します。']] as const).map(([value,title,description]) => <button key={value} type="button" aria-pressed={choice === value} onClick={() => setChoice(value)} className={`rounded-card border bg-canvas p-6 text-left shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-action ${choice === value ? 'border-accent' : 'border-hairline'}`}><span className="text-lg font-bold">{title}</span><span className="mt-3 block text-sm leading-6 text-ink-secondary">{description}</span></button>)}</div><div className="mt-6"><ManualLink href={MANUAL_LINKS.chooseLineAccount}>選び方をマニュアルで見る</ManualLink></div></section> : null}
      {step === 'create' ? <Guide title="新しく公式LINEを作る" intro="LINE Official Account Managerで店舗用のアカウントを作ります。" steps={['LINE Official Account Managerを開く','店舗名などの基本情報を入力する','作成したアカウントを確認する']} manual={<ManualLink href={MANUAL_LINKS.createOfficialAccount}>作り方をマニュアルで見る</ManualLink>} checked={createdOfficial} onChecked={setCreatedOfficial} checkLabel="LINE公式アカウントを作った" /> : null}
      {step === 'api' ? <Guide title="Messaging APIを有効にする" intro="作成済みの公式LINEでMessaging APIを利用できるようにします。" steps={['LINE Official Account Managerの設定を開く','Messaging APIの項目を選ぶ','店舗専用のプロバイダーを選ぶ','Messaging APIを有効にする']} manual={<ManualLink href={MANUAL_LINKS.enableMessagingApi}>設定方法をマニュアルで見る</ManualLink>} checked={apiEnabled} onChecked={setApiEnabled} checkLabel="Messaging APIを有効にした" /> : null}
      {step === 'credentials' ? <section><h1 className="text-3xl font-bold">接続情報の入力</h1><p className="mt-3 text-ink-secondary">LINE Developersに表示される2つの値を入力してください。</p><div className="mt-8 space-y-7 rounded-card border border-hairline bg-canvas p-7"><Field label="チャネルID" help="LINE Developersの「チャネル基本設定」からコピーします。" error={errors.channelId}><input value={channelId} onChange={event => setChannelId(event.target.value)} autoComplete="off" inputMode="numeric" className="w-full rounded-control border border-hairline bg-canvas px-4 py-3 outline-none focus-visible:border-action focus-visible:ring-2 focus-visible:ring-action" /></Field><Field label="チャネルシークレット" help="同じ画面のチャネルシークレットからコピーします。保存後は表示されません。" error={errors.channelSecret}><input type="password" value={channelSecret} onChange={event => setChannelSecret(event.target.value)} autoComplete="new-password" className="w-full rounded-control border border-hairline bg-canvas px-4 py-3 outline-none focus-visible:border-action focus-visible:ring-2 focus-visible:ring-action" /></Field><ManualLink href={MANUAL_LINKS.findChannelCredentials}>値の場所をマニュアルで見る</ManualLink></div></section> : null}
      {step === 'verify' ? <section><h1 className="text-3xl font-bold">接続の確認</h1><p className="mt-3 text-ink-secondary">店舗の呼び名を決めて、LINE公式アカウントへ接続します。</p><div className="mt-8 rounded-card border border-hairline bg-canvas p-7"><Field label="この店舗の呼び名" help="統括画面や店舗コンソールで見分ける名前です。" error={errors.alias}><input value={alias} onChange={event => setAlias(event.target.value)} className="w-full rounded-control border border-hairline bg-canvas px-4 py-3 outline-none focus-visible:border-action focus-visible:ring-2 focus-visible:ring-action" /></Field>{connected ? <dl className="mt-8 grid gap-4 border-t border-hairline pt-6 sm:grid-cols-2"><Result label="表示名" value={connected.lineAccountName} /><Result label="ベーシックID" value={connected.basicId || '取得できませんでした'} /><Result label="友だち数" value={connected.friendCount === null ? '接続後に確認できます' : `${connected.friendCount}人`} /><Result label="Webhookの状態" value={connected.webhook === 'ok' ? '設定済み' : connected.webhook === 'inactive' ? 'LINE側の「Webhookの利用」がオフです。LINE Developers の Messaging API設定でオンにしてください' : 'Webhookの設定に失敗しました。あとから店舗の設定でやり直せます'} /></dl> : null}</div></section> : null}
      {step === 'done' ? <section className="text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-3xl text-success">✓</div><h1 className="mt-6 text-3xl font-bold">{connected?.store.name || alias}を使いはじめられます</h1><p className="mt-3 text-ink-secondary">店舗アカウントの追加が完了しました。</p><div className="mx-auto mt-10 max-w-2xl rounded-card border border-hairline bg-canvas p-7 text-left"><h2 className="text-lg font-bold">次にやること</h2><ol className="mt-5 space-y-4 text-sm text-ink-secondary"><li>1. LINE Developersで「Webhookの利用」をオンにする</li><li>2. 店舗コンソールの基本設定を確認する</li><li>3. 友だち追加用の案内を準備する</li></ol></div></section> : null}
    </main>
    <footer className="fixed inset-x-0 bottom-0 border-t border-hairline bg-canvas"><div className="mx-auto flex min-h-20 max-w-5xl items-center justify-between gap-6 px-6"><p className="text-sm text-ink-secondary">{connected ? '接続情報を保存しました' : '入力内容はこの画面で保持されています'}</p><div className="flex shrink-0 gap-3">{step !== 'choose' && step !== 'done' ? <button type="button" disabled={saving || Boolean(connected)} onClick={back} className={`${buttonClass} border border-hairline bg-canvas`}>戻る</button> : null}{step === 'verify' ? connected ? <button type="button" onClick={() => move('done')} className={`${buttonClass} bg-accent text-on-accent`}>次へ</button> : <button type="button" disabled={saving} onClick={() => void connect()} className={`${buttonClass} bg-accent text-on-accent`}>{saving ? '接続中…' : '接続して保存'}</button> : step === 'done' ? <button type="button" onClick={() => router.replace('/hq')} className={`${buttonClass} bg-accent text-on-accent`}>統括の店舗一覧へ</button> : <button type="button" disabled={(step === 'choose' && !choice) || (step === 'create' && !createdOfficial) || (step === 'api' && !apiEnabled)} onClick={next} className={`${buttonClass} bg-accent text-on-accent`}>次へ</button>}</div></div></footer>
  </div>
}

function Guide({ title, intro, steps, manual, checked, onChecked, checkLabel }: { title: string; intro: string; steps: string[]; manual: ReactNode; checked: boolean; onChecked: (value: boolean) => void; checkLabel: string }) {
  return <section><h1 className="text-3xl font-bold">{title}</h1><p className="mt-3 text-ink-secondary">{intro}</p><ol className="mt-8 space-y-4 rounded-card border border-hairline bg-canvas p-7">{steps.map((item, index) => <li key={item} className="flex items-center gap-4 text-sm"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas-sunken font-bold">{index + 1}</span>{item}</li>)}</ol><div className="mt-6">{manual}</div><label className="mt-8 flex cursor-pointer items-center gap-3 rounded-control border border-hairline bg-canvas p-4 text-sm font-semibold focus-within:ring-2 focus-within:ring-action"><input type="checkbox" checked={checked} onChange={event => onChecked(event.target.checked)} className="h-5 w-5 accent-accent outline-none focus-visible:ring-2 focus-visible:ring-action" />{checkLabel}</label></section>
}

function Result({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold text-ink-faint">{label}</dt><dd className="mt-1 text-sm font-semibold leading-6 text-ink">{value}</dd></div> }
