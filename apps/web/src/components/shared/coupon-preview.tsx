'use client'

import { useState } from 'react'
import { couponDate, couponPresentation, couponPresentationError, type AssetPayloadInput } from '@line-crm/shared'
import { formatDateTime } from '@/lib/format'
import LinePreview from './line-preview'
import SegmentedControl from './segmented'
import StatusBadge from './status-badge'
import Button from './button'
import { safeFlexAssetUrl } from '@/components/flex-preview'
import styles from './coupon-preview.module.css'

/** State switching is a preview only; it never reads or changes a customer's usage. */
export default function CouponPreview({ payload, name, accountName }: { payload: AssetPayloadInput; name: string; accountName?: string }) {
  const [state, setState] = useState<'ready' | 'used' | 'expired'>('ready')
  const numericError = couponPresentationError({ couponType: payload.couponType, discount: payload.discount })
  const view = couponPresentation(numericError ? { ...payload, discount: { mode: 'none' } } : payload, name)
  const limit = typeof payload.maxUsesPerFriend === 'number' && Number.isInteger(payload.maxUsesPerFriend) && payload.maxUsesPerFriend > 0 ? payload.maxUsesPerFriend : payload.oncePerFriend === false ? null : 1
  const ready = state === 'ready' || state === 'used' && (limit === null || limit > 1)
  const image = ready && typeof payload.imageUrl === 'string' ? safeFlexAssetUrl(payload.imageUrl) : null
  const reason = state === 'used' ? 'このクーポンは使用済みです' : '有効期限が切れています'
  const date = (value: unknown) => typeof value === 'string' && Number.isFinite(couponDate(value)) ? formatDateTime(new Date(couponDate(value))) : '未設定'
  return <div className={styles.preview}>
    <SegmentedControl size="small" aria-label="クーポンの見本の状態" value={state} onChange={value => setState(value as typeof state)} options={[{ value: 'ready', label: '使用前' }, { value: 'used', label: '使用済み' }, { value: 'expired', label: '期限切れ' }]} />
    <LinePreview title={null} caption={null} accountName={accountName}>
      <article className={styles.card} data-coupon-preview-state={state}>
        {image ? <img className={styles.image} src={image} alt="クーポンの写真" /> : null}
        <div className={styles.body}>
          <div className={styles.badges}>{view.kindLabel ? <StatusBadge tone="success">{view.kindLabel}</StatusBadge> : null}<StatusBadge tone="neutral">{view.countLabel}</StatusBadge></div>
          <p className={styles.title}>{view.title}</p>
          {state === 'used' && (limit === null || limit > 1) ? <StatusBadge tone="neutral">{limit === null ? '1回使用しました' : `1回使用しました（あと${limit - 1}回）`}</StatusBadge> : null}
          {ready ? <>
            {view.beforePrice ? <del className={styles.note}>{view.beforePrice}</del> : null}
            {view.benefit ? <p className={styles.benefit}>{view.benefit}</p> : null}
          </> : <StatusBadge tone="neutral">{state === 'used' ? '使用済み' : '期限切れ'}</StatusBadge>}
          {view.conditions ? <p className={styles.text}>{view.conditions}</p> : null}
          {ready && view.code ? <p className={styles.text}>クーポンコード：{view.code}</p> : null}
          <p className={styles.note}>{`${date(payload.startsAt)}〜${date(payload.endsAt)}`}</p>
          <p className={styles.label}>利用ガイド</p>
          <p className={styles.guide}>{view.instructions || '未設定'}</p>
          <p className={styles.note}>{view.timezoneNote}</p>
          <Button type="button" variant="primary" fullWidth lockedReason={ready ? undefined : reason} aria-label="クーポンを使用する（見本）">クーポンを使用する</Button>
        </div>
      </article>
    </LinePreview>
  </div>
}
