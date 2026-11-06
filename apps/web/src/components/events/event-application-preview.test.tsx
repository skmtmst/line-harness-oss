// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { EventDetail } from '@/lib/api'

const preview = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ eventsApi: { applicationPreview: preview } }))
import EventPreview from '@/v8/events/application-preview'

beforeEach(() => { document.documentElement.dataset.theme = 'v8'; preview.mockReset() })
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

it('書きかけの住所と枠を送って見本を開き、申し込みは無効', async () => {
  preview.mockResolvedValue({ name: '教室', venueAddress: '住所', venueName: '会場', venueUrl: 'https://public.example/venue', description: null,
    startsAt: '2026-10-12T05:00:00Z', endsAt: '2026-10-12T06:00:00Z', capacity: 20, requiresApproval: false, questions: [], previewOnly: true })
  render(<EventPreview accountId="a" draft={{ name: '教室', venue_address: '住所' } as EventDetail}
    date="2026-10-12" startTime="14:00" endTime="15:00" capacity="20" />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'プレビューを開く →' })) })
  expect(preview).toHaveBeenCalledWith('a', expect.objectContaining({ venue_address: '住所', slot: {
    starts_at: '2026-10-12T05:00:00.000Z', ends_at: '2026-10-12T06:00:00.000Z', capacity: 20,
  } }))
  expect(await screen.findByText('住所')).toBeTruthy()
  expect((screen.getByRole('button', { name: '申し込む' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('link', { name: '会場' }).getAttribute('href')).toBe('https://public.example/venue')
})
