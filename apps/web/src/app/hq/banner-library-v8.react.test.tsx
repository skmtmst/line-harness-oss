// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LibrarySection from '@/components/hq/banners/library-section'
import type { BannerImage } from '@/lib/hq-banners'
const fixture = vi.hoisted(() => ({ images: vi.fn(), projects: vi.fn(), theme: 'v8' as 'v7'|'v8' }))
vi.mock('next/navigation', () => ({useRouter:() => ({push:vi.fn()})}))
vi.mock('@/lib/use-admin-theme', () => ({useAdminTheme:() => fixture.theme}))
vi.mock('@/lib/api', async original => ({...await original<typeof import('@/lib/api')>(),api:{hqBanners:{images:{list:fixture.images},projects:{list:fixture.projects}}}}))
function image(id: string): BannerImage {return {id,projectId:'p',generationId:null,sequence:1,source:'upload',parentImageId:null,isFavorite:false,createdBy:null,createdAt:'2026-10-01T00:00:00Z',media:{id,filename:`${id}.png`,mimeType:'image/png',sizeBytes:100,width:100,height:100,url:`/${id}.png`},generation:null,deliveredAccountIds:[]}}
beforeEach(() => {vi.clearAllMocks();fixture.theme='v8';fixture.projects.mockResolvedValue({success:true,data:[]})})
afterEach(cleanup)
it('取得件数を変えた後に古い「続きを表示」の応答を混ぜない', async () => {
 let resolveOld!: (value: unknown) => void
 fixture.images.mockImplementation((params:{before?:string;limit:number}) => params.before ? new Promise(resolve => {resolveOld=resolve}) : Promise.resolve({success:true,data:[image(params.limit===50?'new':'first')],nextBefore:params.limit===50?null:'cursor'}))
 const {container}=render(<LibrarySection presets={[]} accounts={[]} onChanged={() => {}} />)
 await screen.findByText('さらに10枚を表示')
 expect(fixture.images.mock.calls[0][0]).toMatchObject({limit:10})
 fireEvent.click(screen.getByRole('button',{name:'さらに10枚を表示'}))
 await waitFor(() => expect(resolveOld).toBeDefined())
 fireEvent.click(screen.getByRole('button',{name:'画像の取得件数'}))
 fireEvent.click(within(screen.getByRole('option',{name:'50枚'})).getByRole('button'))
 await waitFor(() => expect(container.querySelector('img[src="/new.png"]')).not.toBeNull())
 await act(async () => resolveOld({success:true,data:[image('old')],nextBefore:'old-cursor'}))
 expect(container.querySelector('img[src="/old.png"]')).toBeNull()
 expect(fixture.images.mock.calls.at(-1)![0]).toMatchObject({limit:50})
})
it('v7の取得は30枚を保ち、新しい件数選択は表示しない', async () => {
 fixture.theme='v7';fixture.images.mockResolvedValue({success:true,data:[],nextBefore:null})
 render(<LibrarySection presets={[]} accounts={[]} onChanged={() => {}} />)
 await screen.findByText('まだ画像がありません')
 expect(fixture.images.mock.calls[0][0]).toMatchObject({limit:30})
 expect(screen.queryByRole('button',{name:'画像の取得件数'})).toBeNull()
})
