'use client'

import { useEffect, useState } from 'react'
import { couponDate, couponPayloadError } from '@line-crm/shared'
import { api, type BroadcastMessageAsset } from '@/lib/api'
import { Field } from '@/components/shared/form-controls'
import Toggle from '@/components/shared/toggle'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import ListState from '@/components/shared/list-state'
import styles from './new/create.module.css'
import { EntityPickerDialog } from '@/components/shared/entity-picker'

export type CouponSettingsValue = { couponEnabled: boolean; couponAssetId: string | null; couponAudience: 'new_friends' | 'all_friends' }

/** 作成と編集で同じ設定を使う。未公開・期限外・別の店の候補は渡さない。 */
export default function CouponSettings({ accountId, value, onChange, onOptionsLoaded, disabled = false }: {
  accountId?: string | null; value: CouponSettingsValue; onChange: (next: CouponSettingsValue) => void; onOptionsLoaded?: (items: BroadcastMessageAsset[]) => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<BroadcastMessageAsset[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setOpen(false); setItems([]); setState('loading')
    if (!value.couponEnabled || !accountId) return
    void api.broadcastMessageAssets.list({ accountId, kind: 'coupon' }).then((response) => {
      if (!current) return
      if (!response.success) throw new Error('unavailable')
      const now = Date.now()
      const eligible = response.data.filter((item) => {
        const payload = item.publishedPayload ?? item.payload
        return item.lineAccountId === accountId && (item.publishedVersion ?? 0) > 0
          && !couponPayloadError(payload) && now >= couponDate(payload.startsAt as string) && now < couponDate(payload.endsAt as string)
      })
      setItems(eligible)
      onOptionsLoaded?.(eligible)
      setState('ready')
    }).catch(() => { if (current) setState('error') })
    return () => { current = false }
  }, [accountId, value.couponEnabled, attempt, onOptionsLoaded])
  const selected = items.find((item) => item.id === value.couponAssetId)
  const payload = selected?.publishedPayload ?? selected?.payload
  return <>
    <div className={styles.fieldRow}>
      <div className={styles.field}>
        <h2 className={styles.cardTitle}>読み取った人にクーポンを渡す</h2>
        <p className={styles.cardNote}>オンにすると、友だち追加のあとトークにクーポンが届きます（1人1回）</p>
      </div>
      <Toggle checked={value.couponEnabled} disabled={disabled} label="クーポンを渡す"
        onChange={(couponEnabled) => onChange({ ...value, couponEnabled })} />
    </div>
    {value.couponEnabled ? <>
      <Field label="渡すクーポン" required note={selected ? `${String(payload?.description ?? '')}・期限 ${String(payload?.endsAt ?? '')}` : '公開中で、利用期間内のクーポンを選んでください。'}>
        {selected ? <StatusBadge tone="warning" dot={false}>{selected.name}</StatusBadge> : null}
        <Button disabled={disabled || !accountId} onClick={() => setOpen(true)}>{value.couponAssetId ? 'クーポンを変える' : 'クーポンを選ぶ'}</Button>
      </Field>
      <Field label="渡す相手">
        <Select aria-label="渡す相手" value={value.couponAudience} disabled={disabled} size="full"
          options={[{ value: 'new_friends', label: '新しく友だちになった人だけ' }, { value: 'all_friends', label: 'すでに友だちの人にも' }]}
          onChange={(couponAudience) => onChange({ ...value, couponAudience: couponAudience as CouponSettingsValue['couponAudience'] })} />
      </Field>
      <Notice tone="info" message="1人1回だけ渡します。同じ人が何度読み取っても、2枚目は渡しません。すでに友だちの人にも渡す設定では、読み取るとクーポンの画面が開きます。" />
      {open ? <EntityPickerDialog title="クーポンを選ぶ" initialId={value.couponAssetId ?? undefined}
        items={items.map((item) => ({ id: item.id, name: item.name, meta: `${String((item.publishedPayload ?? item.payload).description ?? '')}・期限 ${String((item.publishedPayload ?? item.payload).endsAt ?? '')}` }))}
        state={state === 'loading' ? <ListState kind="loading" /> : state === 'error' ? <ListState kind="error" title="クーポンを読み込めませんでした" onRetry={() => setAttempt((n) => n + 1)} /> : undefined}
        onConfirm={(couponAssetId) => { onChange({ ...value, couponAssetId }); setOpen(false) }} onCancel={() => setOpen(false)} /> : null}
    </> : null}
  </>
}
