'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Eye, FlaskConical, Gift, Plus, X } from 'lucide-react'
import { api, type NenCampaignAfterAction, type NenCampaignSetting } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { Field, inputClass } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import StickyBar from '@/components/shared/sticky-bar'
import InsertToolbar from '@/components/scenarios/insert-toolbar'
import { usePageTitle } from '@/components/shell/page-chrome'

const TRIGGER_LABEL: Record<string, string> = {
  'ec.order.confirmed': '注文を受け付けたとき',
  'ec.order.shipped': '商品を発送したとき',
  'ec.order.delivered': '注文が届いたとき',
  'ec.order.arrived': '注文が届いたとき',
  'pet.birthday': 'ペットの誕生日',
}

type FormOption = { id: string; name: string; description: string | null }

function triggerLabel(setting: NenCampaignSetting): string {
  if (setting.campaignKey === 'birthday_coupon') return 'ペットの誕生日'
  if (!setting.triggerEvent) return '手動で送る'
  return TRIGGER_LABEL[setting.triggerEvent] ?? '登録済みのきっかけ'
}

function previewBody(value: string): string {
  return value
    .replaceAll('{{pet_name}}', 'ももちゃん')
    .replaceAll('{{ペットの名前}}', 'もも')
    .replaceAll('{{商品名}}', 'フード')
    .replaceAll('{{name}}', '高橋 直人')
}

function openFormUrl(liffId: string | null | undefined, formId: string): string | null {
  if (!liffId) return null
  return `https://liff.line.me/${liffId}/?page=form&id=${encodeURIComponent(formId)}`
}

export default function CampaignEditor({ campaignKey }: { campaignKey: string }) {
  const [setting, setSetting] = useState<NenCampaignSetting | null>(null)
  const [draft, setDraft] = useState<Partial<NenCampaignSetting>>({})
  const [forms, setForms] = useState<FormOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [testSearchOpen, setTestSearchOpen] = useState(false)
  const [testSearch, setTestSearch] = useState('')
  const [testCandidates, setTestCandidates] = useState<Array<{ id: string; displayName: string | null }>>([])
  const [testLoginUsers, setTestLoginUsers] = useState<Array<{ id: string; displayName: string }>>([])
  const [testing, setTesting] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const { selectedAccountId, selectedAccount } = useAccount()

  usePageTitle(`${setting?.label ?? 'NEN配信'}を編集する`)

  useEffect(() => {
    if (!selectedAccountId) {
      setLoading(false)
      setError('LINEアカウントを選んでください')
      return
    }
    let cancelled = false
    setLoading(true)
    void Promise.all([
      api.nenCampaigns.settings(selectedAccountId),
      api.forms.list(selectedAccountId),
    ]).then(([settingsResponse, formsResponse]) => {
      if (cancelled) return
      if (settingsResponse.success) {
        const found = settingsResponse.data.find((item) => item.campaignKey === campaignKey) ?? null
        setSetting(found)
        if (found) setDraft(found)
        else setError('この配信が見つかりませんでした')
      }
      if (formsResponse.success) setForms(formsResponse.data)
    }).catch(() => {
      if (!cancelled) setError('読み込みに失敗しました')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [campaignKey, selectedAccountId])

  useEffect(() => {
    setTestLoginUsers([])
    setTestCandidates([])
    if (!selectedAccountId) return
    let cancelled = false
    void api.accountSettings.getTestRecipientLoginUsers(selectedAccountId)
      .then((response) => {
        if (cancelled || !response.success) return
        const candidates = response.data
          .filter((candidate) => candidate.sameAccount)
          .map((candidate) => ({ id: candidate.id, displayName: candidate.staffName }))
        setTestLoginUsers(candidates)
        setTestCandidates(candidates)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedAccountId])

  const merged = { ...setting, ...draft } as NenCampaignSetting
  const actions = merged.afterActions ?? []
  const formAction = actions.find((action) => action.kind === 'open_form')
  const mileageAction = actions.find((action) => action.kind === 'award_mileage')
  const isBirthday = merged.campaignKey === 'birthday_coupon'

  const setActions = (afterActions: NenCampaignAfterAction[]) => {
    setDraft((previous) => ({ ...previous, afterActions }))
  }

  const addFormAction = (formId: string) => {
    const form = forms.find((candidate) => candidate.id === formId)
    if (!form) return
    const next: NenCampaignAfterAction = {
      kind: 'open_form', formId: form.id, formName: form.name, buttonLabel: '感想を書く（30秒）',
    }
    setDraft((previous) => ({
      ...previous,
      afterActions: [...actions.filter((action) => action.kind !== 'open_form'), next],
      buttonLabel: next.buttonLabel,
      buttonUrl: openFormUrl(selectedAccount?.liffId, form.id) ?? merged.buttonUrl,
    }))
  }

  const addMileageAction = () => {
    setActions([
      ...actions.filter((action) => action.kind !== 'award_mileage'),
      { kind: 'award_mileage', amount: 200, trigger: 'form_submitted' },
    ])
  }

  const searchFriends = async () => {
    const query = testSearch.trim()
    const response = await api.friends.list({ search: query, accountId: selectedAccountId ?? undefined, limit: 5 })
    if (!response.success) return
    const loginUsers = testLoginUsers.filter((candidate) => candidate.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    const friends = response.data.items.map((friend) => ({ id: friend.id, displayName: friend.displayName }))
    setTestCandidates([...new Map([...loginUsers, ...friends].map((candidate) => [candidate.id, candidate])).values()])
  }

  const sendTest = async (friendId: string) => {
    if (!selectedAccountId) return
    setTesting(true)
    setError('')
    setNotice('')
    try {
      await api.nenCampaigns.testSend({ campaignKey, accountId: selectedAccountId, friendId })
      setNotice('テスト送信しました')
      setTestSearchOpen(false)
    } catch {
      setError('テスト送信できませんでした')
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!setting || !selectedAccountId) return
    if (!merged.bodyText?.trim()) {
      setError('本文を入力してください')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await api.nenCampaigns.updateSetting(selectedAccountId, setting.campaignKey, {
        isEnabled: merged.isEnabled,
        title: merged.title,
        bodyText: merged.bodyText,
        delayDays: merged.delayDays,
        deliveryTime: merged.deliveryTime,
        buttonLabel: formAction?.buttonLabel ?? merged.buttonLabel,
        buttonUrl: formAction ? openFormUrl(selectedAccount?.liffId, formAction.formId) ?? merged.buttonUrl : merged.buttonUrl,
        imageUrl: merged.imageUrl,
        afterActions: actions,
      })
      if (!response.success) {
        setError('保存に失敗しました')
        return
      }
      setSetting(merged)
      setNotice('配信内容を保存しました')
    } catch {
      setError('保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <ListState kind="loading" title="NEN配信を読み込んでいます" />
  if (!setting) return <ListState kind="error" title={error || 'この配信が見つかりませんでした'} />

  const timing = isBirthday ? '誕生日の3日前 10:00 に届きます' : `注文が届いてから${merged.delayDays}日後 ${merged.deliveryTime.slice(0, 5)} に届きます`

  return (
    <div data-design-node="HpKyF" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="text-ink-faint flex min-w-0 flex-1 items-center gap-2 text-xs" aria-label="パンくず">
          <Link href="/nen-campaigns" className="text-accent hover:underline">NEN配信</Link><span>›</span>
          <Link href="/nen-campaigns?tab=flows" className="text-accent hover:underline">配信フロー</Link><span>›</span><span>{setting.label}</span>
        </nav>
        <button type="button" onClick={() => setTestSearchOpen((open) => !open)} className="border-hairline text-ink rounded-control flex h-10 items-center gap-2 border bg-white px-4 text-sm font-bold hover:bg-canvas-sunken"><FlaskConical aria-hidden size={17} />自分にテスト送信</button>
      </div>

      {error && <p className="bg-danger-bg text-danger rounded-card px-4 py-3 text-sm">{error}</p>}
      {notice && <p className="bg-accent-soft text-accent rounded-card px-4 py-3 text-sm">{notice}</p>}

      {testSearchOpen && (
        <section className="bg-canvas rounded-card border-hairline flex flex-wrap items-center gap-2 border p-3">
          <input type="search" value={testSearch} onChange={(event) => setTestSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchFriends() }} placeholder="テスト送信の相手を名前で探す" aria-label="テスト送信の相手を名前で探す" className={`${inputClass} max-w-sm`} />
          <button type="button" onClick={() => void searchFriends()} className="border-hairline rounded-control border px-3 py-2 text-sm">探す</button>
          {testCandidates.map((candidate) => <button key={candidate.id} type="button" disabled={testing} onClick={() => void sendTest(candidate.id)} className="bg-accent-deep text-on-accent rounded-control px-3 py-2 text-sm">{candidate.displayName ?? '名前なし'}へ送る</button>)}
        </section>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-4">
            <h2 className="text-ink mb-4 text-base font-bold">いつ送りますか</h2>
             <div className="grid gap-3 md:grid-cols-[1.3fr_120px_140px_220px]">
              <Field label="きっかけ"><p className="border-hairline rounded-control border px-3 py-2 text-sm">{triggerLabel(setting)}</p></Field>
              <Field label={isBirthday ? '送る日' : '何日後'}>{isBirthday ? <p className="border-hairline rounded-control border px-3 py-2 text-sm">3日前</p> : <input type="number" min={0} max={365} value={merged.delayDays} onChange={(event) => setDraft((previous) => ({ ...previous, delayDays: Number(event.target.value) }))} className={inputClass} />}</Field>
              <Field label="時刻">{isBirthday ? <p className="border-hairline rounded-control border px-3 py-2 text-sm">10:00（固定）</p> : <input type="time" value={merged.deliveryTime.slice(0, 5)} onChange={(event) => setDraft((previous) => ({ ...previous, deliveryTime: event.target.value }))} className={inputClass} />}</Field>
               <Field label="届かない日"><p className="border-hairline rounded-control border px-3 py-2 text-sm">なし（毎日送る）</p></Field>
             </div>
             {isBirthday && <p className="text-ink-faint mt-3 text-xs">この日時は誕生日配信の実行処理で固定されています。</p>}
             {!isBirthday && <div className="mt-4 space-y-3">
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" defaultChecked className="accent-accent mt-0.5" /><span><strong className="block">同じ人に何度も送らない</strong><span className="text-ink-faint text-xs">30日のあいだに1回だけにします。まとめ買いのときに何通も届くのを防ぎます。</span></span></label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" defaultChecked className="accent-accent mt-0.5" /><span><strong className="block">すでに口コミを書いた人には送らない</strong><span className="text-ink-faint text-xs">EC連携の口コミの記録を見ています。</span></span></label>
            </div>}
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-4">
            <h2 className="text-ink mb-4 text-base font-bold">送るもの</h2>
            <div className="bg-canvas-sunken rounded-card border-hairline border p-3">
              <div className="mb-3 flex items-center justify-between gap-3"><p className="text-ink-secondary text-xs font-bold">1つめ ／ リッチメッセージ</p><div className="flex gap-2"><button type="button" className="border-hairline rounded-control border bg-white px-3 py-1.5 text-xs">差し替える</button><button type="button" className="border-hairline rounded-control border bg-white px-3 py-1.5 text-xs">消す</button></div></div>
              <div className="rounded-card border-hairline border bg-white p-3">
                <InsertToolbar targetRef={bodyRef} value={merged.bodyText} onChange={(bodyText) => setDraft((previous) => ({ ...previous, bodyText }))} />
                <p className="text-ink-faint mt-2 text-right text-xs tabular-nums">{merged.bodyText.length.toLocaleString('ja-JP')} / 4,500</p>
                <textarea ref={bodyRef} rows={5} maxLength={4500} value={merged.bodyText} onChange={(event) => setDraft((previous) => ({ ...previous, bodyText: event.target.value }))} aria-label="配信本文" className={`${inputClass} mt-2 resize-y leading-relaxed`} />
              </div>
            </div>
            <button type="button" className="border-hairline text-ink-secondary rounded-control mt-3 flex h-11 w-full items-center justify-center gap-2 border text-sm font-bold"><Plus aria-hidden size={16} />吹き出しを追加する（あと2つまで）</button>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-4">
            <h2 className="text-ink text-base font-bold">押されたあとにすること</h2><p className="text-ink-faint mt-1 text-xs">リッチメッセージの面を押した人に何をするかです。</p>
            <div className="mt-3 space-y-2">
              {formAction?.kind === 'open_form' && <div className="border-hairline rounded-control flex items-center gap-3 border px-4 py-3"><span className="text-accent text-lg">▣</span><div className="min-w-0 flex-1"><p className="text-sm font-bold">回答フォーム「{formAction.formName}」を開く</p><p className="text-ink-faint text-xs">星の評価と、ひとことだけの短いフォームです</p></div><button type="button" aria-label="回答フォームを外す" onClick={() => setActions(actions.filter((action) => action !== formAction))}><X aria-hidden size={16} /></button></div>}
              {mileageAction?.kind === 'award_mileage' && <div className="border-hairline rounded-control flex items-center gap-3 border px-4 py-3"><Gift aria-hidden className="text-accent" size={18} /><div className="min-w-0 flex-1"><p className="text-sm font-bold">書いてくれたらマイルを {mileageAction.amount.toLocaleString('ja-JP')} 付ける</p><p className="text-ink-faint text-xs">回答フォームへの送信をきっかけにしています</p></div><button type="button" aria-label="マイル付与を外す" onClick={() => setActions(actions.filter((action) => action !== mileageAction))}><X aria-hidden size={16} /></button></div>}
              {!formAction && <label className="block text-xs font-bold">回答フォームを開く<select defaultValue="" onChange={(event) => addFormAction(event.target.value)} className={`${inputClass} mt-1`}><option value="" disabled>回答フォームを選ぶ</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>}
              {!mileageAction && <button type="button" onClick={addMileageAction} className="border-hairline rounded-control flex w-full items-center justify-center gap-2 border px-3 py-2 text-sm"><Gift aria-hidden size={16} />回答後に200マイル付ける</button>}
            </div>
          </section>
        </div>

        <aside className="space-y-3">
          <section className="bg-canvas rounded-card border-hairline border p-4">
            <p className="text-ink-secondary mb-3 flex items-center gap-2 text-xs font-bold"><Eye aria-hidden size={15} />高橋 直人さん（ももちゃん）にはこう届きます</p>
            <div className="bg-line-preview rounded-card p-4"><h2 className="text-on-accent text-center text-sm font-bold">LINEプレビュー</h2><p className="mt-3 text-center"><span className="bg-line-preview-label text-on-accent rounded-pill px-3 py-1 text-[10px] font-bold">◷ {timing}</span></p><div className="mt-4 rounded-card bg-white p-4"><p className="text-sm leading-relaxed whitespace-pre-wrap">{previewBody(merged.bodyText)}</p>{merged.buttonLabel && <p className="bg-accent-deep text-on-accent rounded-control mt-3 py-2 text-center text-xs font-bold">★ {merged.buttonLabel}</p>}</div></div>
          </section>
          <section className="bg-canvas rounded-card border-hairline border p-4"><h2 className="text-sm font-bold">つながる先</h2><dl className="mt-3 space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-accent font-bold">→ EC連携</dt><dd className="text-ink-secondary">注文と到着の記録</dd></div><div className="flex justify-between gap-3"><dt className="text-accent font-bold">→ 共通情報</dt><dd className="text-ink-secondary">差し込んでいる「商品名」</dd></div><div className="flex justify-between gap-3"><dt className="text-accent font-bold">→ 友だち属性</dt><dd className="text-ink-secondary">友だち情報欄「ペットの名前」</dd></div>{mileageAction?.kind === 'award_mileage' && <div className="flex justify-between gap-3"><dt className="text-accent font-bold">→ マイル</dt><dd className="text-ink-secondary">書いてくれたら {mileageAction.amount}</dd></div>}{formAction?.kind === 'open_form' && <div className="flex justify-between gap-3"><dt className="text-accent font-bold">→ 回答フォーム</dt><dd className="text-ink-secondary">{formAction.formName}</dd></div>}</dl></section>
          <section className="border-warning bg-warning-bg text-warning rounded-card border p-4"><h2 className="text-sm font-bold">気をつけること</h2><div className="mt-3 space-y-3 text-xs"><p><strong className="block">◷ 20時台がいちばん押されます</strong>分析の「配信の反応」で確かめられます</p><p><strong className="block">▣ 3つ以上の吹き出しは嫌がられます</strong>1回に3つ送った配信は、ブロック率が3倍でした</p></div></section>
        </aside>
      </div>

      <StickyBar status={merged.isEnabled ? '動いています。保存すると、これから届く42通に新しい中身が使われます。' : '停止中です。保存しても新しい配信は始まりません。'} actions={<><Link href="/nen-campaigns" className="border-hairline rounded-control border px-4 py-2 text-sm font-bold">キャンセル</Link><button type="button" onClick={() => setTestSearchOpen(true)} className="border-hairline rounded-control flex items-center gap-2 border px-4 py-2 text-sm font-bold"><FlaskConical aria-hidden size={16} />自分にテスト送信</button><button type="button" onClick={() => void save()} disabled={saving} className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50">{saving ? '保存中…' : '配信内容を保存'}</button></>} />
    </div>
  )
}
