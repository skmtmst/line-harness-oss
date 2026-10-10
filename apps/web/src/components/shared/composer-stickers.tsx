'use client'

import { useState } from 'react'
import SegmentedControl from './segmented'
import FilterChip from './filter-chip'
import { TextField } from './text-field'
import styles from './composer-stickers.module.css'

// LINE公開の基本スタンプ。https://developers.line.biz/en/docs/messaging-api/sticker-list/
const PACKS = [
  { id: '11537', label: 'ブラウン＆コニー', stickers: ['52002734', '52002735', '52002736', '52002737', '52002738', '52002739', '52002740', '52002741', '52002742', '52002743', '52002744', '52002745', '52002746', '52002747', '52002748', '52002749'] },
  { id: '446', label: 'ムーン', stickers: ['1988', '1989', '1990', '1991', '1992', '1993', '2000', '2001'] },
  { id: '789', label: 'サリー', stickers: ['10855', '10856', '10857', '10877'] },
] as const
function Thumb({ id }: { id: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? <span>{id}</span> : <img alt={`スタンプ ${id}`} src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${id}/android/sticker.png`} onError={() => setFailed(true)} />
}
export default function ComposerStickers({ value, onChange }: { value: { packageId: string; stickerId: string }; onChange: (next: { packageId: string; stickerId: string }) => void }) {
  const [mode, setMode] = useState<'pick' | 'manual'>('pick')
  const [packId, setPackId] = useState(value.packageId || '11537')
  const pack = PACKS.find((item) => item.id === packId) ?? PACKS[0]
  return <div className={styles.root}>
    <SegmentedControl size="sticker" aria-label="スタンプの決め方" options={[{ value: 'pick', label: '一覧から選ぶ' }, { value: 'manual', label: '番号を直接入れる' }]} value={mode} onChange={setMode} />
    {mode === 'pick' ? <><div className={styles.packs}>{PACKS.map((item) => <FilterChip size="compact" showCheck={false} key={item.id} selected={pack.id === item.id} onChange={() => setPackId(item.id)}>{item.label}</FilterChip>)}</div><div className={styles.grid}>{pack.stickers.map((id) => <button key={id} type="button" aria-label={`スタンプ ${id}`} aria-pressed={value.packageId === pack.id && value.stickerId === id} onClick={() => onChange({ packageId: pack.id, stickerId: id })}><Thumb id={id} /></button>)}</div></> : <div className={styles.manual}><label>パッケージID<TextField inputMode="numeric" value={value.packageId} onChange={(event) => onChange({ ...value, packageId: event.target.value })} /></label><label>スタンプID<TextField inputMode="numeric" value={value.stickerId} onChange={(event) => onChange({ ...value, stickerId: event.target.value })} /></label></div>}
    {value.packageId && value.stickerId ? <p>{`選んだスタンプ：パッケージ ${value.packageId} ・ スタンプ ${value.stickerId}`}</p> : null}
  </div>
}
