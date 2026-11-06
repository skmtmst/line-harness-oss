// @vitest-environment happy-dom
import React from 'react'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
const f=vi.hoisted(()=>({list:vi.fn(),get:vi.fn()}))
vi.mock('@/lib/api',async original=>{const actual=await original<typeof import('@/lib/api')>();return {...actual,api:{...actual.api,entryRoutes:{list:f.list,get:f.get}}}})
vi.mock('@/lib/qr-image',()=>({qrToDataURL:async()=> 'data:image/png;base64,fixture'}))
import QrDialog from './qr-dialog'
import {ApiError} from '@/lib/api'
beforeEach(()=>{f.list.mockReset().mockResolvedValue({success:true,data:[]});f.get.mockReset()})
afterEach(cleanup)
const props={open:true,onClose:()=>{},accountName:'人工店',baseLink:'https://fixture.invalid/base'}
it('QR窓の経路取得失敗と空を分けて読み直す',async()=>{
 f.list.mockRejectedValueOnce(new Error('fixture failure'))
 render(<QrDialog {...props}/>)
 const error=await screen.findByText('経路を読み込めませんでした')
 fireEvent.click(error.closest('[data-list-state="error"]')!.querySelector('button')!)
 await waitFor(()=>expect(screen.queryByText('経路を読み込めませんでした')).toBeNull())
 expect(f.list).toHaveBeenCalledTimes(2)
})
it('指定経路の500を消えた経路と扱わず、同じ経路を再取得する',async()=>{
 f.get.mockRejectedValueOnce(new ApiError(500,'fixture failure')).mockResolvedValue({success:true,data:{id:'r',name:'復帰した経路',refCode:'r',isActive:true}})
 render(<QrDialog {...props} routes={[]} initialRouteId="r"/>)
 const error=await screen.findByText('経路を読み込めませんでした')
 expect(screen.queryByText(/このアカウントでは見つかりません/)).toBeNull()
 fireEvent.click(error.closest('[data-list-state="error"]')!.querySelector('button')!)
 await waitFor(()=>expect(screen.queryByText('経路を読み込めませんでした')).toBeNull())
 expect(f.get).toHaveBeenCalledTimes(2)
 expect(screen.getByAltText('友だち追加QRコード')).toBeTruthy()
})
it('指定経路の404だけは見つからない案内を出す',async()=>{
 f.get.mockRejectedValue(new ApiError(404,'fixture missing'))
 render(<QrDialog {...props} routes={[]} initialRouteId="r"/>)
 expect(await screen.findByText(/このアカウントでは見つかりません/)).toBeTruthy()
 expect(screen.queryByAltText('友だち追加QRコード')).toBeNull()
})
