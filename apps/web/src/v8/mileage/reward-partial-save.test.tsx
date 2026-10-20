// @vitest-environment happy-dom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {fireEvent} from '@testing-library/react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({push:vi.fn(),create:vi.fn(),test:vi.fn(),save:vi.fn(),publish:vi.fn(),role:'owner' as string|null}));
vi.mock('@/lib/staff-role',async original=>({...await original<typeof import('@/lib/staff-role')>(),useStaffRole:()=>f.role}));
vi.mock('next/link',()=>({default:({children,...props}:React.ComponentProps<'a'>)=><a {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:f.push,replace:vi.fn()}),useSearchParams:()=>new URLSearchParams('')}));
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'synthetic-account',accounts:[],loading:false})}));
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{}}));
vi.mock('@/lib/api',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/api')>(),api:{featureSettings:{visibility:async()=>({success:true,data:{features:{}}})},commonActions:{resources:async()=>({success:true,data:{commonActions:[]}})},mileage:{createReward:f.create,testReward:f.test,saveRewardDraft:f.save,publishReward:f.publish}}}));
import Editor from '@/v8/mileage/reward-edit';
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
beforeEach(()=>{
 vi.clearAllMocks();f.role='owner';let n=0;
 f.create.mockImplementation(async(_account,draft)=>({success:true,data:{id:`synthetic-${++n}`,status:'draft',currentDraftVersionId:`v-${n}`,currentVersion:{revision:1},...draft}}));
 f.save.mockResolvedValue({success:true,data:{id:'synthetic-1',currentDraftVersionId:'v-1',currentVersion:{revision:2}}});
 f.test.mockResolvedValue({success:true,data:{canDeliver:true,requiredMiles:100}});
 window.history.replaceState(null,'','/');
 (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove()});
async function click(text:string){const b=[...host.querySelectorAll('button')].find(x=>x.textContent?.includes(text));expect(b).toBeTruthy();await act(async()=>{b!.click()})}
async function input(id:string,value:string){await act(async()=>{fireEvent.change(host.querySelector('#'+id)!,{target:{value}})})}
it('OPS-C01 交換テスト後の保存は同じ下書きを継続する',async()=>{
 await act(async()=>root.render(<Editor/>));
 await input('reward-name','synthetic reward');await input('reward-miles','100');
 await click('自分で交換をテスト');
 expect(f.create).toHaveBeenCalledTimes(1);expect(f.test).toHaveBeenCalledWith('synthetic-1','synthetic-account');
 expect(host.textContent).toContain('交換テストに合格しました');
 await click('下書きを保存');
 expect(f.create).toHaveBeenCalledTimes(1);expect(f.save).not.toHaveBeenCalled(); // ：変えていない保存済みの下書きは再送しない。
 expect(f.push).toHaveBeenCalled();
});

it.each([null,'staff','viewer'])('役割%sでは保存・公開・交換テストを出さず変更APIも呼ばない',async role=>{
 f.role=role;
 await act(async()=>root.render(<Editor/>));
 expect(host.textContent).toContain('閲覧のみ');
 expect(host.textContent).toContain('一覧へ戻る');
 expect([...host.querySelectorAll('button')].some(button=>/下書きを保存|保存して出す|自分で交換をテスト/.test(button.textContent??''))).toBe(false);
 expect(f.create).not.toHaveBeenCalled();expect(f.save).not.toHaveBeenCalled();expect(f.test).not.toHaveBeenCalled();
});
it('公開だけ失敗したら下書きを重ねず、入力変更後は新しい版で公開する',async()=>{
 const { ApiError } = await import('@/lib/api')
 f.publish.mockReset().mockRejectedValueOnce(new ApiError(500,'人工の公開失敗')).mockResolvedValue({success:true,data:{id:'synthetic-1',status:'published'}})
 f.save.mockResolvedValue({success:true,data:{id:'synthetic-1',currentDraftVersionId:'v-2',currentVersion:{id:'v-2',revision:2}}})
 await act(async()=>root.render(<Editor/>))
 await input('reward-name','人工の特典');await input('reward-miles','100')
 await click('保存して出す')
 const confirm=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='使い道を公開')!
 await act(async()=>{confirm.click();confirm.click()})
 expect(f.create).toHaveBeenCalledTimes(1)
 expect(f.publish).toHaveBeenCalledTimes(1)
 expect(host.textContent).toContain('できた分：マイルの使い道の下書き')
 expect(host.textContent).toContain('残り：公開')
 expect(host.textContent).toContain('入力は残っています')
 await input('reward-name','変更した特典')
 await click('残りだけもう一度')
 expect(f.create).toHaveBeenCalledTimes(1)
 expect(f.save).toHaveBeenCalledTimes(1)
 expect(f.publish.mock.calls.map(call=>call.slice(0,4))).toEqual([
  ['synthetic-1','synthetic-account','v-1',1],['synthetic-1','synthetic-account','v-2',2],
 ])
})
