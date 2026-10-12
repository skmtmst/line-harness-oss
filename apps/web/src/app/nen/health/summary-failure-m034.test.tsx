// @vitest-environment happy-dom
/*
 * M034：「30日のまとめ」の取得失敗を、原因どおりに言い分ける。
 * 本物の React で確かめる試験。
 *
 * - 403 は権限の案内にし、押しても直らない「もう一度読み込む」は出さない
 * - 429 は待ち案内にし、再試行の口は残す
 * - 生の `API error: 403` は出さない
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

const fixture = vi.hoisted(() => ({ accountId: 'A' as string }))
const m = vi.hoisted(() => ({ summary: vi.fn() }))

vi.mock('@/components/shared/page-header', () => ({ default: () => null }))
vi.mock('@/components/shell/page-chrome', async () => ({ ...(await import('@/test-utils/page-chrome-mock')).pageChromeMock(), usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId }) }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/nen-pets-api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/nen-pets-api')>(), nenPetsApi: { healthSummary: m.summary, health: async () => ({ success: true, data: LIST }) } }))

import Page from './page'

const ROW = {
 pet:{id:'pet-A',name:'PetA',callName:'PetA',animalType:'dog',breed:'',ageLabel:'1',imageUrl:null},
 owner:{friendId:'f1',name:'Owner',customerId:null},lastLoggedOn:null,lastLoggedLabel:'',daysSinceLast:null,count30d:0,totalRecords:0,
 weightSeries:[null,null,null,null,null,null,null,null],latestWeightKg:null,weightChangePercent:null,latestStool:null,latestAppetite:null,changes:[],concerning:false,
}
const LIST={items:[ROW,{...ROW,pet:{...ROW.pet,id:'pet-B',name:'PetB'}}],total:2,page:1,pageSize:20,kpis:{recordsThisWeek:0,petsWithRecords:2,petsTotal:2,concerning:0,silent30:2}}
function openPet(name:string) {
 fireEvent.click(screen.getByRole('button',{name:'\u300c'+name+'\u300d\u306e\u64cd\u4f5c'}))
 fireEvent.click(screen.getByRole('menuitem',{name:'30\u65e5\u306e\u307e\u3068\u3081'}))
}


const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  fixture.accountId = 'A'
})

describe('M034 30日のまとめの取得失敗', () => {
  it('403は権限の案内になり、再読み込みの口を出す', async () => {
    m.summary.mockRejectedValueOnce(new ApiError(403, 'API error: 403'))
    render(<Page />)
    await screen.findByText('PetA'); openPet('PetA')
    await flush()

    expect(document.body.textContent).toContain('権限')
    expect(document.body.textContent).not.toContain('API error: 403')
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeTruthy()
  })

  it('429は待ち案内になり、再試行の口は残る', async () => {
    m.summary.mockRejectedValueOnce(new ApiError(429, 'API error: 429'))
    render(<Page />)
    await screen.findByText('PetA'); openPet('PetA')
    await flush()

    expect(document.body.textContent).toMatch(/混み合っています|待って/)
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeTruthy()
  })
})
