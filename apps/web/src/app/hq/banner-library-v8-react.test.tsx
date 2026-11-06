// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import HqBannersListV8 from '@/v8/hq-banners/list'
import { api } from '@/lib/api'
import { flushListUrlState } from '@/components/shared/list-url-state'
import type { BannerImage } from '@/lib/hq-banners'
const fixture = vi.hoisted(() => ({ images: vi.fn(), projects: vi.fn(), theme: 'v8' as 'v7'|'v8' }))

const nav = vi.hoisted(() => ({ query: '', push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: () => {} }), useSearchParams: () => new URLSearchParams(nav.query) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', () => ({ useStaffIdentity: () => ({ id: 'banner-test-staff' }), useStaffRole: () => 'owner', canManageRole: () => true }))
function image(id: string): BannerImage {return {id,projectId:'p',generationId:null,sequence:1,source:'upload',parentImageId:null,isFavorite:false,createdBy:null,createdAt:'2026-10-01T00:00:00Z',media:{id,filename:`${id}.png`,mimeType:'image/png',sizeBytes:100,width:100,height:100,url:`/${id}.png`},generation:null,deliveredAccountIds:[]}}
beforeEach(() => {vi.clearAllMocks();
  flushListUrlState()
  window.history.replaceState({}, '', '/hq/banners?tab=library')
  nav.query = 'tab=library'
  vi.spyOn(api.hqBanners, 'presets').mockResolvedValue({ success: true, data: {
    presets: [], maxCount: 10, engineReady: true,
    usage: { month: { used: 0, limit: 100, remaining: 100 }, today: { used: 0, limit: 10, remaining: 10 }, paused: false, pausedReason: null },
  } })
  vi.spyOn(api.hqBanners, 'stats').mockResolvedValue({ success: true, data: { projects: { active: 0, archived: 0 }, deliveredImages: 0, deliveredAccounts: 0 } })
  vi.spyOn(api.lineAccounts, 'list').mockResolvedValue({ success: true, data: [] })

 vi.spyOn(api.hqBanners.images, 'list').mockImplementation(fixture.images)
 vi.spyOn(api.hqBanners.projects, 'list').mockImplementation(fixture.projects)
 fixture.projects.mockResolvedValue({success:true,data:[]})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('取得件数を変えた後に古い「続きを表示」の応答を混ぜない', async () => {
 let resolveOld!: (value: unknown) => void
 fixture.images.mockImplementation((params:{before?:string;limit:number}) => params.before ? new Promise(resolve => {resolveOld=resolve}) : Promise.resolve({success:true,data:[image(params.limit===50?'new':'first')],nextBefore:params.limit===50?null:'cursor'}))
 const {container}=render(<HqBannersListV8 />)
 await screen.findByText('次の 12 件')
 expect(fixture.images.mock.calls[0][0]).toMatchObject({limit:12})
 fireEvent.click(screen.getByRole('button',{name:'次の 12 件'}))
 await waitFor(() => expect(resolveOld).toBeDefined())
 fireEvent.click(screen.getByRole('button',{name:'画像の取得件数'}))
 fireEvent.click(screen.getByRole('menuitem',{name:'50枚'}))
 await waitFor(() => expect(container.querySelector('img[src="/new.png"]')).not.toBeNull())
 await act(async () => resolveOld({success:true,data:[image('old')],nextBefore:'old-cursor'}))
 expect(container.querySelector('img[src="/old.png"]')).toBeNull()
 expect(fixture.images.mock.calls.at(-1)![0]).toMatchObject({limit:50})
})
