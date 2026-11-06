// @vitest-environment happy-dom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {act,cleanup,render,screen,waitFor} from '@testing-library/react'
const api=vi.hoisted(()=>({program:vi.fn(),preview:vi.fn(),save:vi.fn(),tiers:vi.fn(),activate:vi.fn(),stop:vi.fn()}))
vi.mock('@/lib/api/helpers/gap3',()=>({memberRanksApi:api}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=>'/mileage',useSearchParams:()=>new URLSearchParams('tab=ranks')}))
const context=vi.hoisted(()=>({selectedAccountId:'a',selectedAccount:{id:'a',name:'検証商店'},accounts:[{id:'a',name:'検証商店'}],loading:false}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>context}))
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{}}))
vi.mock('./frame',async original=>({...await original<typeof import('./frame')>(),useMileageShell:()=>({tab:'ranks',readonly:false,narrow:false,counts:{},setCount:()=>{}})}))
import RanksTab from './ranks'
const program={metric:'visits',windowMonths:12,status:'stopped',version:1,activatedAt:null,notificationsAvailable:false,notifyUpgrade:true,notifyDowngrade:true,tiers:[] as unknown[]}
beforeEach(()=>{context.selectedAccountId='a';context.selectedAccount={id:'a',name:'検証商店'};context.accounts=[context.selectedAccount];api.program.mockResolvedValue({success:true,data:program});api.preview.mockResolvedValue({success:true,data:{byTier:[],wouldUpgrade:0,wouldDowngrade:0}})})
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('未作成なら見本も未作成とし、架空のランクや倍率を出さない',async()=>{
 render(<RanksTab/>);await waitFor(()=>expect(api.program).toHaveBeenCalledWith('a'))
 await screen.findByText('ランクを作るとLINEの見本を確認できます')
 const phone=document.querySelector('[data-line-preview-part="phone"]')!
 expect(phone.textContent).not.toContain('ゴールド');expect(phone.textContent).not.toContain('1.5')
})
it('同じ取得結果の段名と倍率、選択店の名前を見本へ渡す',async()=>{
 api.program.mockResolvedValue({success:true,data:{...program,tiers:[{id:'base',name:'会員',threshold:0,mileMultiplier:1},{id:'regular',name:'常連',threshold:3,mileMultiplier:2.4}]}})
 render(<RanksTab/>);await screen.findByText('常連')
 const phone=document.querySelector('[data-line-preview-part="phone"]')!
 expect(phone.textContent).toContain('検証商店');expect(phone.textContent).toContain('常連になりました');expect(phone.textContent).toContain('2.4 倍')
})
it('店を切り替えた直後と取得失敗で前の段を出さず、遅い前店の応答も捨てる',async()=>{
 let finish:(value:unknown)=>void=()=>{}
 api.program.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockRejectedValueOnce(new Error('offline'))
 const view=render(<RanksTab/>);await waitFor(()=>expect(api.program).toHaveBeenCalledWith('a'))
 context.selectedAccountId='b';context.accounts=[{id:'b',name:'次の店'}]
 view.rerender(<RanksTab/> )
 const phone=()=>document.querySelector('[data-line-preview-part="phone"]')!
 expect(phone()).toBeNull()
 await waitFor(()=>expect(api.program).toHaveBeenCalledWith('b'))
 await screen.findByRole('button',{name:/もう一度読み込む|読み直し/})
 await act(async()=>finish({success:true,data:{...program,tiers:[{id:'old',name:'前の店の段',threshold:0,mileMultiplier:3}]}}))
 expect(phone()).toBeNull();expect(view.container.textContent).not.toContain('前の店の段')
})
it('段の倍率と店名の欠損は架空の値で補わない',async()=>{
 context.selectedAccount={id:'other',name:'他の店'};context.accounts=[]
 api.program.mockResolvedValue({success:true,data:{...program,tiers:[{id:'base',name:'会員',threshold:0,mileMultiplier:null}]}})
 render(<RanksTab/>);await screen.findByText(/会員になりました/)
 const phone=document.querySelector('[data-line-preview-part="phone"]')!
 expect(phone.textContent).toContain('店名未取得');expect(phone.textContent).toContain('倍率は未取得')
 expect(phone.textContent).not.toContain('他の店');expect(phone.textContent).not.toContain('1.5')
})
