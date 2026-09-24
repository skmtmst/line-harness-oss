'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'
import TargetMissing from '@/components/shared/target-missing'
import { useAccount } from '@/contexts/account-context'

/**
 * 送信Webhookの編集（#939 N-363）。
 *
 * 作ったあとに「名前・URL・いつ送るか・送り直す回数」を直せるようにする。
 * 合言葉（シークレット）はここでは触らない。入れ直しは一覧の
 * 「設定 → 合言葉」から行う（値が画面に残らない専用の窓がある）。
 */
function EditWebhookPageInner() {
  const { selectedAccountId } = useAccount()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [eventTypes, setEventTypes] = useState('')
  const [maxRetries, setMaxRetries] = useState('0')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
  /** 失敗したあとの「もう一度読み込む」で取り直すための番号。 */
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!id || !selectedAccountId) {
      setLoadState(selectedAccountId === null ? 'loading' : 'error')
      return
    }
    setLoadState('loading')
    void api.webhooks.outgoing.detail(id, selectedAccountId)
      .then((res) => {
        if (cancelled) return
        if (!res.success) {
          setLoadState('error')
          return
        }
        setName(res.data.name)
        setUrl(res.data.url)
        setEventTypes(res.data.eventTypes.join(', '))
        setMaxRetries(String(res.data.maxRetries ?? 0))
        setLoadState('ready')
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        if (caught instanceof ApiError && caught.status === 404) setLoadState('not-found')
        else setLoadState('error')
      })
    return () => { cancelled = true }
  }, [id, reloadKey, selectedAccountId])

  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="直す送り先が指定されていません"
        description="外部連携の一覧から「設定 → 直す」で開いてください。"
        backHref="/webhooks"
        backLabel="外部連携の一覧へ戻る"
      />
    )
  }
  if (loadState === 'not-found') {
    return (
      <TargetMissing
        kind="not-found"
        title="この送り先は見つかりません"
        description="消えているか、別のLINEアカウントのものかもしれません。一覧から選び直してください。"
        backHref="/webhooks"
        backLabel="外部連携の一覧へ戻る"
      />
    )
  }
  if (loadState === 'error') {
    return (
      <TargetMissing
        kind="error"
        title="送り先の設定を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    )
  }

  return (
    <CreatePage
      title="送り先を直す"
      description="送り先の設定を直します。合言葉はこの画面では変わりません。"
      parent={['外部連携', '/webhooks']}
      saveLabel="保存する"
      successHref={() => '/webhooks'}
      validate={() => {
        if (!selectedAccountId) return 'LINEアカウントを選択してください'
        if (!name.trim()) return '名前を入力してください'
        if (!/^https:\/\//.test(url.trim())) return 'URLは https:// で始めてください'
        const retries = Number(maxRetries)
        if (!Number.isInteger(retries) || retries < 0 || retries > 5) {
          return '送り直しは0から5の整数にしてください'
        }
        return null
      }}
      onSave={async () => {
        if (!selectedAccountId) throw new Error('LINEアカウントを選択してください')
        const res = await api.webhooks.outgoing.update(id, selectedAccountId, {
          name: name.trim(),
          url: url.trim(),
          eventTypes: eventTypes
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          maxRetries: Number(maxRetries) || 0,
        })
        if (!res.success) throw new Error(res.error)
      }}
    >
      {loadState === 'loading' ? (
        <p className="text-ink-faint text-sm">現在の設定を読み込んでいます…</p>
      ) : (
        <>
          <p className="text-ink text-sm font-semibold">基本の設定</p>

          <Field label="名前" htmlFor="wh-edit-name" required>
            <input
              id="wh-edit-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="送り先のURL" htmlFor="wh-edit-url" required note="https:// のみです。">
            <input
              id="wh-edit-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="送るイベント" htmlFor="wh-edit-events" note="カンマ区切り。* を入れると全部のイベントを送ります。">
            <input
              id="wh-edit-events"
              type="text"
              value={eventTypes}
              onChange={(event) => setEventTypes(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field
            label="失敗したときの送り直し"
            htmlFor="wh-edit-retries"
            note="相手が 5xx を返したときや、つながらなかったときに送り直します。上限は5回です。"
          >
            <div className="flex items-center gap-1.5">
              <input
                id="wh-edit-retries"
                type="number"
                min={0}
                max={5}
                value={maxRetries}
                onChange={(event) => setMaxRetries(event.target.value)}
                className={`${inputClass} w-24 tabular-nums`}
              />
              <span className="text-ink-faint text-xs">回まで</span>
            </div>
          </Field>
        </>
      )}
    </CreatePage>
  )
}

export default function EditWebhookPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <EditWebhookPageInner />
    </Suspense>
  )
}
