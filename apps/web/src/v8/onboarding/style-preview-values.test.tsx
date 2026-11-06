// @vitest-environment happy-dom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,render} from '@testing-library/react'
import {setTestReducedMotion} from '@/test-utils/reduced-motion'
import StyleChoiceStep from './style-choice-step'
import {PhonePane} from './style-experience-player/scenes'
import {STYLE_EXPERIENCE_SCRIPT} from './style-experience-player'
import {LiffPhoneMenuStep,LiffPhoneStaffStep,LiffPhoneDatetimeStep} from '@/v8/booking-menus/public/liff-phone'
import StyleSetupWizard from './wizard'
const context=vi.hoisted(()=>({accounts:[{id:'a',name:'検証商店'}],selectedAccount:{id:'a',name:'検証商店'},loading:false,error:null as string|null}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>context}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=>'/'}))
beforeEach(()=>{setTestReducedMotion(true);context.accounts=[{id:'a',name:'検証商店'}];context.selectedAccount=context.accounts[0];context.loading=false;context.error=null})
afterEach(cleanup)
it.each(['restaurant','salon','consult','lesson','standard','ec'] as const)('%sの見本は渡された店名を使う',style=>{
 const view=render(<StyleChoiceStep viewing={style} onView={()=>{}} chosen={null} onChoose={()=>{}} accountName="検証商店"/> )
 const phone=view.container.querySelector('[data-pane="phone"]')!
 expect(phone.textContent).toContain('検証商店')
})
it('店名未取得はサンプル店名に置き換えない',()=>{
 const view=render(<StyleChoiceStep viewing="restaurant" onView={()=>{}} chosen={null} onChoose={()=>{}}/> )
 const phone=view.container.querySelector('[data-pane="phone"]')!
 expect(phone.textContent).toContain('店名未取得');expect(phone.textContent).not.toContain('musubo - 和食 -')
})
it.each(['menu','staff','datetime'] as const)('予約の%s段は実名を渡せ、省略した既存の使い方も壊さない',step=>{
 const view=render(step==='menu'?<LiffPhoneMenuStep accountName="検証商店" menus={[]}/>:step==='staff'?<LiffPhoneStaffStep accountName="検証商店" menu={null} staff={[]} designationFree/>:<LiffPhoneDatetimeStep accountName="検証商店" menu={null} staffName={null} slots={[]} closedDates={[]} closedWeekdays={[]} view="list"/>)
 expect(view.container.textContent).toContain('検証商店')
 view.rerender(step==='menu'?<LiffPhoneMenuStep menus={[]}/>:step==='staff'?<LiffPhoneStaffStep menu={null} staff={[]} designationFree/>:<LiffPhoneDatetimeStep menu={null} staffName={null} slots={[]} closedDates={[]} closedWeekdays={[]} view="list"/>)
 expect(view.container.querySelector('[data-liff-phone]')??view.container.firstElementChild).toBeTruthy()
})
it('確認の「お店」もスマホの見出しと同じ店名になり、台本は書き換えない',()=>{
 const look={...STYLE_EXPERIENCE_SCRIPT.styles.restaurant,account:'検証商店'}
 const scene=look.scenes.find(item=>item.phone.part==='booking-facts')!
 const before=JSON.stringify(STYLE_EXPERIENCE_SCRIPT)
 const view=render(<PhonePane phone={scene.phone} style="restaurant" look={look} base={new Date('2026-10-06T00:00:00Z')}/> )
 expect(view.container.querySelector('dl')?.textContent).toContain('検証商店')
 expect(view.container.textContent).not.toContain('musubo - 和食 -')
 expect(JSON.stringify(STYLE_EXPERIENCE_SCRIPT)).toBe(before)
})
it('はじめの質問も同じaccountの実名だけを使い、次の店の取得中・失敗で前の名前を使わない',()=>{
 const state={style:'restaurant' as const,styleSelected:true,version:1,answers:{}}
 const view=render(<StyleSetupWizard key="a" accountId="a" state={state} onClose={()=>{}}/> )
 const phone=()=>document.querySelector('[data-pane="phone"]')!
 expect(phone().textContent).toContain('検証商店')
 context.loading=true
 view.rerender(<StyleSetupWizard key="b" accountId="b" state={state} onClose={()=>{}}/> )
 expect(phone().textContent).toContain('店名未取得');expect(phone().textContent).not.toContain('検証商店')
 context.loading=false;context.error='failed'
 view.rerender(<StyleSetupWizard key="b" accountId="b" state={state} onClose={()=>{}}/> )
 expect(phone().textContent).toContain('店名未取得');expect(phone().textContent).not.toContain('検証商店')
 context.error=null;context.accounts=[{id:'b',name:'次の店'}];context.selectedAccount=context.accounts[0]
 view.rerender(<StyleSetupWizard key="b" accountId="b" state={state} onClose={()=>{}}/> )
 expect(phone().textContent).toContain('次の店')
})
