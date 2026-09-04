'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { TERMS_DOCUMENT } from '@/content/terms/musubo-terms'
import { MANUAL_LINKS } from '@/lib/manual-links'
import { restaurantTestApi } from '@/lib/restaurant-test-api'
import TermsConsent from './terms-consent'
import { initialWizardStep, STEP } from './terms-state'
import { usePageTitle } from '@/components/shell/page-chrome'
import StickyBar from '@/components/shared/sticky-bar'

const steps = [
  ['利用規約への同意', 'musuboの利用規約と、個人情報の取扱いをご確認ください。'],
  ['店舗の基本情報', '店舗名と、管理画面で使う略称を入力します。'],
  ['LINE公式アカウントを作る', 'LINE側で店舗専用の公式アカウントを用意します。'],
  ['Messaging APIを有効にして接続する', 'チャネルIDとチャネルシークレットを確認します。'],
  ['接続の確認', 'LINEへ接続し、店舗を登録します。'],
] as const

type FieldErrors = Partial<Record<'name' | 'channelId' | 'channelSecret', string>>

function formatAgreementDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(parsed)
}

function ManualLink({ href, children }: { href: string; children: ReactNode }) {
  if (!href) {
    return <span aria-disabled="true" className="inline-flex cursor-not-allowed rounded-control border border-hairline bg-canvas-sunken px-3 py-2 text-xs font-semibold text-ink-faint">マニュアルは準備中です</span>
  }
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex rounded-control border border-action px-3 py-2 text-xs font-semibold text-action">{children}</a>
}

function Field({
  label,
  required,
  help,
  error,
  children,
}: {
  label: string
  required: boolean
  help: string
  error?: string
  children: ReactNode
}) {
  return <div>
    <div className="mb-2 flex items-center gap-2"><label className="text-sm font-semibold text-ink">{label}</label><span className={`rounded-pill px-2 py-1 text-[10px] font-semibold ${required ? 'bg-danger-bg text-danger' : 'bg-canvas-sunken text-ink-secondary'}`}>{required ? '必須' : '任意'}</span></div>
    {children}
    <p className="mt-2 text-xs leading-5 text-ink-secondary">{help}</p>
    {error && <p role="alert" className="mt-1 text-xs font-semibold text-danger">{error}</p>}
  </div>
}

export default function NewRestaurantStorePage() {
  usePageTitle('店舗を追加')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [step, setStep] = useState<number>(STEP.TERMS)
  const [termsAgreedAt, setTermsAgreedAt] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [alias, setAlias] = useState('')
  const [officialAccountReady, setOfficialAccountReady] = useState(false)
  const [channelId, setChannelId] = useState('')
  const [channelSecret, setChannelSecret] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [connectionError, setConnectionError] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<{ id: string; storeName: string; lineAccountName: string } | null>(null)

  useEffect(() => {
    let active = true
    setTermsAgreedAt(null)
    setStep(STEP.TERMS)
    void restaurantTestApi.termsAgreement(selectedAccountId).then((response) => {
      if (!active) return
      const nextStep = initialWizardStep(response.data.agreedVersion)
      setTermsAgreedAt(nextStep === STEP.BASICS ? response.data.agreedAt : null)
      setStep(nextStep)
    }).catch(() => {
      if (!active) return
      setTermsAgreedAt(null)
      setStep(STEP.TERMS)
    })
    return () => { active = false }
  }, [selectedAccountId])

  const agreeToCurrentTerms = async () => {
    const response = await restaurantTestApi.agreeToTerms(
      selectedAccountId,
      TERMS_DOCUMENT.key,
      TERMS_DOCUMENT.version,
    )
    setTermsAgreedAt(response.data.agreedAt)
    setStep(STEP.BASICS)
  }

  const agreementDate = formatAgreementDate(termsAgreedAt)

  const nextFromBasics = () => {
    if (!name.trim()) {
      setErrors({ name: '店舗名を入力してください。' })
      return
    }
    setErrors({})
    setStep(STEP.OFFICIAL_ACCOUNT)
  }

  const nextFromCredentials = () => {
    const next: FieldErrors = {}
    if (!channelId.trim()) next.channelId = 'チャネルIDを入力してください。'
    if (!channelSecret.trim()) next.channelSecret = 'チャネルシークレットを入力してください。'
    setErrors(next)
    if (Object.keys(next).length === 0) setStep(STEP.CONNECT)
  }

  const connect = async () => {
    if (saving) return
    setSaving(true)
    setConnectionError('')
    try {
      const response = await restaurantTestApi.connectStore(selectedAccountId, {
        name: name.trim(),
        alias: alias.trim(),
        channelId: channelId.trim(),
        channelSecret: channelSecret.trim(),
      })
      setCreated({
        id: response.data.store.id,
        storeName: response.data.store.name,
        lineAccountName: response.data.lineAccountName,
      })
      setChannelSecret('')
    } catch (caught) {
      setConnectionError(caught instanceof Error ? caught.message : '接続を確認できませんでした。入力内容を確認してください。')
    } finally {
      setSaving(false)
    }
  }

  const enterStore = async () => {
    if (!selectedAccountId || !created) return
    setSaving(true)
    try {
      await restaurantTestApi.selectStore(selectedAccountId, created.id)
      router.push('/restaurant-test/dashboard')
    } catch (caught) {
      setConnectionError(caught instanceof Error ? caught.message : '店舗画面へ切り替えられませんでした。')
      setSaving(false)
    }
  }

  return <div>
    <Header description="利用規約の確認からLINE公式アカウントの接続まで、5つの手順で進めます。" action={<Link href="/hq" className="text-sm font-semibold text-action">統括へ戻る</Link>} />
    <div className="grid items-start gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
      <ol className="rounded-card border border-hairline bg-canvas p-4">{steps.map(([title, description], index) => {
        const number = index + 1
        const complete = number === STEP.TERMS
          ? Boolean(termsAgreedAt) || Boolean(created)
          : number < step || Boolean(created)
        const current = number === step && !created
        return <li key={title} className="relative flex gap-3 pb-6 last:pb-0">
          {number < steps.length && <span className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-hairline" />}
          <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${complete ? 'bg-accent text-on-accent' : current ? 'bg-ink text-canvas' : 'bg-canvas-sunken text-ink-faint'}`}>{complete ? '✓' : number}</span>
          <div>{number === STEP.TERMS && complete
            ? <Link href="/restaurant-test/terms" className="block"><p className="text-sm font-semibold text-success">{title}</p><p className="mt-1 text-xs leading-5 text-ink-faint">✓ 完了{agreementDate ? `（同意済み：${agreementDate}）` : ''}</p></Link>
            : <><p className={`text-sm font-semibold ${complete ? 'text-success' : current ? 'text-ink' : 'text-ink-faint'}`}>{title}</p><p className="mt-1 text-xs leading-5 text-ink-faint">{description}</p></>}</div>
        </li>
      })}</ol>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="rounded-card border border-hairline bg-canvas p-5 sm:p-7">
          <p className="text-xs font-semibold text-ink-faint">ステップ {step} / 5</p>
          <h2 className="mt-2 text-xl font-bold text-ink">{steps[step - 1][0]}</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{steps[step - 1][1]}</p>

          {step === STEP.TERMS && <TermsConsent onAgree={agreeToCurrentTerms} />}

          {step === STEP.BASICS && <div className="mt-7 space-y-6">
            <Field label="店舗名" required help="お客様にも伝わる正式な店舗名を入力してください。" error={errors.name}>
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="organization" className="w-full rounded-control border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-accent" />
            </Field>
            <Field label="店舗の略称" required={false} help="管理画面で店舗を見分ける短い名前です。空欄の場合は店舗名を使います。">
              <input value={alias} onChange={(event) => setAlias(event.target.value)} className="w-full rounded-control border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-accent" />
            </Field>
            <StickyBar actions={<button type="button" onClick={nextFromBasics} className="rounded-control bg-accent-deep px-5 py-2.5 text-sm font-semibold text-on-accent">次へ</button>} />
          </div>}

          {step === STEP.OFFICIAL_ACCOUNT && <div className="mt-7 space-y-5">
            <div className="rounded-card bg-canvas-sunken p-5 text-sm leading-7 text-ink-secondary">
              <p className="font-semibold text-ink">まずはLINE公式アカウントの登録を行いましょう。</p>
              <p className="mt-2">LINE公式アカウントをお持ちでない方は、LINE for Businessから無料で店舗専用のアカウントを開設してください。作成後、この画面へ戻ってチェックを入れます。</p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-control border border-hairline px-4 py-3 text-sm font-semibold text-ink"><input type="checkbox" checked={officialAccountReady} onChange={(event) => setOfficialAccountReady(event.target.checked)} className="mt-0.5 h-4 w-4 accent-accent" />LINE公式アカウントを作成済みです</label>
            <StickyBar actions={<><button type="button" onClick={() => setStep(STEP.BASICS)} className="rounded-control border border-hairline px-4 py-2.5 text-sm font-semibold text-ink">戻る</button><button type="button" disabled={!officialAccountReady} onClick={() => setStep(STEP.CREDENTIALS)} className="rounded-control bg-accent-deep px-5 py-2.5 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-40">次へ</button></>} />
          </div>}

          {step === STEP.CREDENTIALS && <div className="mt-7 space-y-6">
            <p className="rounded-control bg-info-bg px-4 py-3 text-sm leading-6 text-ink-secondary">LINE公式アカウントのチャネルIDとチャネルシークレットを使用して、アカウントセットアップを行います。</p>
            <Field label="チャネルID" required help="LINE Developersの「チャネル基本設定」にある数字をコピーしてください。" error={errors.channelId}>
              <input value={channelId} onChange={(event) => setChannelId(event.target.value)} inputMode="numeric" autoComplete="off" className="w-full rounded-control border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-accent" />
            </Field>
            <Field label="チャネルシークレット" required help="同じ「チャネル基本設定」のチャネルシークレットをコピーしてください。保存後、この値は画面に表示されません。" error={errors.channelSecret}>
              <input type="password" value={channelSecret} onChange={(event) => setChannelSecret(event.target.value)} autoComplete="new-password" className="w-full rounded-control border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-accent" />
            </Field>
            <StickyBar actions={<><button type="button" onClick={() => setStep(STEP.OFFICIAL_ACCOUNT)} className="rounded-control border border-hairline px-4 py-2.5 text-sm font-semibold text-ink">戻る</button><button type="button" onClick={nextFromCredentials} className="rounded-control bg-accent-deep px-5 py-2.5 text-sm font-semibold text-on-accent">次へ</button></>} />
          </div>}

          {step === STEP.CONNECT && <div className="mt-7">
            {created ? <div className="rounded-card border border-accent bg-accent-soft p-5">
              <p className="text-lg font-bold text-success">接続できました</p>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">「{created.storeName}」とLINE公式アカウント「{created.lineAccountName}」を登録しました。</p>
              {selectedAccountId
                ? <button type="button" disabled={saving} onClick={() => void enterStore()} className="mt-5 rounded-control bg-accent-deep px-5 py-2.5 text-sm font-semibold text-on-accent disabled:opacity-50">この店舗の管理画面へ</button>
                : <Link href="/hq" className="mt-5 inline-flex text-sm font-semibold text-action">統括の店舗一覧へ</Link>}
            </div> : <>
              <div className="rounded-card bg-canvas-sunken p-5 text-sm leading-6 text-ink-secondary"><p className="font-semibold text-ink">以下のLINE公式アカウントのセットアップを行います。</p><p className="mt-1">トークンとボット表示名を取得できた場合だけ、店舗とLINE公式アカウントをまとめて登録します。</p><dl className="mt-4 grid gap-2"><div><dt className="text-xs text-ink-faint">店舗名</dt><dd className="font-semibold text-ink">{name}</dd></div><div><dt className="text-xs text-ink-faint">店舗の略称</dt><dd className="font-semibold text-ink">{alias || name}</dd></div></dl></div>
              {connectionError && <div role="alert" className="mt-4 rounded-control border border-danger bg-danger-bg px-4 py-3 text-sm leading-6 text-danger">{connectionError}</div>}
              <StickyBar className="mt-5" actions={<><button type="button" disabled={saving} onClick={() => setStep(STEP.CREDENTIALS)} className="rounded-control border border-hairline px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-40">戻る</button><button type="button" disabled={saving} onClick={() => void connect()} className="rounded-control bg-accent-deep px-5 py-2.5 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-40">{saving ? '接続を確認中…' : 'アカウントセットアップ実行'}</button></>} />
            </>}
          </div>}
        </main>

        <aside className="rounded-card border border-hairline bg-canvas p-5">
          <h2 className="font-bold text-ink">わからないときは</h2>
          <p className="mt-2 text-xs leading-5 text-ink-secondary">今の手順に対応するマニュアルを確認できます。</p>
          <div className="mt-4 space-y-3">{step === STEP.TERMS ? <><p className="text-xs leading-5 text-ink-secondary">同意する前に、利用規約と個人情報の取扱いを最後まで確認してください。</p><Link href="/restaurant-test/terms" className="inline-flex rounded-control border border-action px-3 py-2 text-xs font-semibold text-action">利用規約を別画面で読む</Link></>
            : step === STEP.BASICS ? <p className="text-xs leading-5 text-ink-secondary">店舗名はあとから店舗設定で変更できます。</p>
            : step === STEP.OFFICIAL_ACCOUNT ? <><div className="rounded-control bg-canvas-sunken p-3"><p className="text-xs font-semibold leading-5 text-ink">店舗ごとに、新しいプロバイダーを作ってください。</p><p className="mt-2 text-xs leading-5 text-ink-secondary">LINEのユーザーIDはプロバイダーごとに発行されます。複数の店舗を同じプロバイダーにまとめると、同じお客様を店舗ごとに別々に管理できなくなります。</p></div><ManualLink href={MANUAL_LINKS.createOfficialAccount}>LINE公式アカウントを作る</ManualLink></>
            : step === STEP.CREDENTIALS ? <><p className="text-xs font-semibold text-ink">アカウント作成方法・連携ガイド</p><ManualLink href={MANUAL_LINKS.enableMessagingApi}>Messaging APIを有効にする</ManualLink><ManualLink href={MANUAL_LINKS.findChannelCredentials}>2つの値の場所を見る</ManualLink><div className="border-t border-hairline pt-3"><p className="text-xs font-semibold text-ink">よくある質問</p><p className="mt-2 text-xs leading-5 text-ink-secondary">「Messaging APIを利用する」ボタンが表示されません</p><p className="mt-2 text-xs leading-5 text-ink-secondary">チャネルシークレットが正しくないと表示されます</p></div></>
            : <div><p className="text-xs font-semibold text-ink">よくある質問</p><p className="mt-2 text-xs leading-5 text-ink-secondary">接続できない場合は、1つ前の手順へ戻り、LINE Developersから値をコピーし直してください。</p></div>}</div>
        </aside>
      </div>
    </div>
  </div>
}
