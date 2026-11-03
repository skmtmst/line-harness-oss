// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BookingResource } from '@/lib/api'
const remove=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/api', async original => { const actual=await original<typeof import('@/lib/api')>(); return {...actual,bookingApi:{...actual.bookingApi,deleteResource:remove}} })
import { ResourceRowV8 } from './tabs/hours-tab'
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('設備削除の対象を示し、アカウント切替前の確定を拒む',()=>{
 const resource={id:'room',name:'見本の設備',version:1,isActive:true,capacity:1,type:'room',usage:{referenced:false}} as BookingResource
 const props={resource,canEdit:true,onSaved:vi.fn(),onDeleted:vi.fn()}
 const view=render(<ResourceRowV8 {...props} accountId="a" />)
 fireEvent.click(screen.getByRole('button',{name:'「見本の設備」のそのほかの操作'}))
 fireEvent.click(screen.getByRole('menuitem',{name:'設備を削除する'}))
 const dialog=screen.getByRole('alertdialog')
 expect(dialog.textContent).toContain('LINEアカウント')
 const confirm=within(dialog).getByRole('button',{name:'削除する'})
 const key=Object.keys(confirm).find(item=>item.startsWith('__reactProps$'))!
 const oldConfirm=(confirm as unknown as Record<string,{onClick:(event:unknown)=>void}>)[key].onClick
 view.rerender(<ResourceRowV8 {...props} accountId="b" />)
 view.rerender(<ResourceRowV8 {...props} accountId="a" />)
 act(()=>oldConfirm({preventDefault(){},stopPropagation(){}}))
 expect(remove).not.toHaveBeenCalled()
})
