'use client'

import { useRef, useState } from 'react'
import ActionMenu from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import StatusBadge from '@/components/shared/status-badge'
import type { BookingVisitMark } from '@/lib/api'

/** 採用B-1（lS8qh）。人の予約の印。席予約の来店処理には使わない。 */
export default function PeopleVisitActions({ mark, ready, busy, canMark, onMark, onUnmark }: {
  mark: BookingVisitMark | null
  ready: boolean
  busy: boolean
  canMark: boolean
  onMark: (kind: BookingVisitMark['kind'], lateMinutes?: number) => void
  onUnmark: () => void
}) {
  const lateAnchor = useRef<HTMLButtonElement>(null)
  const moreAnchor = useRef<HTMLButtonElement>(null)
  const [lateOpen, setLateOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  if (!canMark) return null
  if (mark?.kind === 'visited' || mark?.kind === 'no_show') return <span className="inline-flex items-center gap-2">
    <StatusBadge tone={mark.kind === 'visited' ? 'success' : 'neutral'}>{mark.kind === 'visited' ? '来店した' : '来なかった'}</StatusBadge>
    <Button variant="text" size="inline" disabled={busy || !ready} onClick={onUnmark}>取り消す</Button>
  </span>
  return <span className="inline-flex items-center gap-2">
    {mark?.kind === 'late' ? <StatusBadge tone="warning">{mark.late_minutes}分遅れる</StatusBadge> : null}
    <Button variant="primary" size="booking" disabled={busy || !ready} onClick={() => onMark('visited')}>来店した</Button>
    <Button ref={lateAnchor} size="booking" disabled={busy || !ready} aria-expanded={lateOpen} onClick={() => { setMoreOpen(false); setLateOpen(!lateOpen) }}>遅れる</Button>
    <ActionMenu open={lateOpen} anchorRef={lateAnchor} onClose={() => setLateOpen(false)} ariaLabel="遅れる分数" items={[5, 10, 15, 30].map(minutes => ({ id: `late-${minutes}`, label: `${minutes}分`, onSelect: () => { setLateOpen(false); onMark('late', minutes) } }))} />
    <Button ref={moreAnchor} size="booking" disabled={busy || !ready} aria-label="その他の操作" aria-expanded={moreOpen} onClick={() => { setLateOpen(false); setMoreOpen(!moreOpen) }}>…</Button>
    <ActionMenu open={moreOpen} anchorRef={moreAnchor} onClose={() => setMoreOpen(false)} ariaLabel="その他の操作" items={[
      { id: 'no-show', label: '来なかった', onSelect: () => { setMoreOpen(false); onMark('no_show') } },
      ...(mark ? [{ id: 'unmark', label: '印を取り消す', onSelect: () => { setMoreOpen(false); onUnmark() } }] : []),
    ]} />
  </span>
}
