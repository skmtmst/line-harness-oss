// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const preview = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ eventsApi:{applicationPreview:preview} }))
vi.mock('@/components/shared/dialog', () => ({default:({open,children}:any)=>open ? <div>{children}</div>:null}))
import EventPreview from './event-application-preview'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
it('書きかけの住所と枠を送って見本を開き、申し込みは無効', async () => {
 preview.mockResolvedValue({name:'教室',venueAddress:'住所',venueName:'会場',venueUrl:null,description:null,startsAt:'2026-10-12T05:00:00Z',endsAt:'2026-10-12T06:00:00Z',capacity:20,requiresApproval:false,questions:[],previewOnly:true})
 const host=document.createElement('div'), root=createRoot(host)
 try {
  await act(async()=>{root.render(<EventPreview accountId="a" draft={{name:'教室',venue_address:'住所'} as any} slot={{date:'2026-10-12',startTime:'14:00',durationMinutes:60,capacity:'20'}} />)})
  await act(async()=>{host.querySelector('button')!.click()})
  expect(preview).toHaveBeenCalledWith('a',expect.objectContaining({venue_address:'住所',slot:{starts_at:'2026-10-12T05:00:00.000Z',ends_at:'2026-10-12T06:00:00.000Z',capacity:20}}))
  expect(host.textContent).toContain('住所')
  expect([...host.querySelectorAll('button')].find(x=>x.textContent==='申し込む')?.disabled).toBe(true)
 } finally {await act(async()=>root.unmount())}
})
