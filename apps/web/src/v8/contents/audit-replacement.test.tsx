// @vitest-environment happy-dom
import React from 'react'
import type { MediaItem } from '@line-crm/shared'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ impact: vi.fn(), replace: vi.fn() }))
vi.mock('@/components/shared/select', () => ({ default: ({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) => <select aria-label="差し替え先" value={value} onChange={e => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }))
vi.mock('@/lib/api', () => ({ ApiError: class extends Error {}, api: { media: { list: async () => ({ success: true, data: { items: [{ id: 'r', filename: 'R', kind: 'image' }], total: 1 } }), replacementImpact: net.impact, replaceUsages: net.replace } } }))
import Dialog from './media-replacement-dialog'
afterEach(cleanup)
it('WEB-094: 選択を解除すると、遅れた影響確認で実行を復活させない', async () => {
 let finish!: (v: unknown) => void; net.impact.mockImplementation(() => new Promise(r => { finish = r }))
 render(<Dialog source={{ id: 's', filename: 'S', kind: 'image' } as MediaItem} accountId="a" onClose={vi.fn()} onComplete={vi.fn()} />)
 await screen.findByRole('option', { name: /R/ })
 fireEvent.change(screen.getByLabelText('差し替え先'), { target: { value: 'r' } })
 fireEvent.change(screen.getByLabelText('差し替え先'), { target: { value: '' } })
 await act(async () => finish({ success: true, data: { replacement: { id: 'r', filename: 'R' }, canReplace: true, references: [], blockedByKind: {}, revision: 'rev' } }))
 expect((screen.getByRole('button', { name: '使用先を差し替える' }) as HTMLButtonElement).disabled).toBe(true)
})
