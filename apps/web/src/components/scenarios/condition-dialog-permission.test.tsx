// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
const held=vi.hoisted(()=>({buttons:new Map<string,()=>Promise<void>|void>(),builder:null as null|((next:import('@/lib/segment-condition').SegmentCondition|null)=>void),reads:vi.fn(async()=>({success:true as const,data:[]}))}))
vi.mock('@/lib/api',async original=>{const actual=await original<typeof import('@/lib/api')>();return {...actual,api:{...actual.api,tags:{...actual.api.tags,list:held.reads},scenarios:{...actual.api.scenarios,list:held.reads}}}})
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'account',accounts:[]})}))
vi.mock('@/lib/use-feature-visibility',()=>({useFeatureVisibility:()=>({enabled:()=>false})}))
vi.mock('@/components/shared/button',async original=>{const {default:Actual,...rest}=await original<typeof import('@/components/shared/button')>();return {...rest,default:(p:ComponentProps<typeof Actual>)=>{if(typeof p.children==='string'&&p.onClick)held.buttons.set(p.children,p.onClick as ()=>Promise<void>|void);return <Actual {...p}/>}}})
vi.mock('@/components/shared/condition-builder',async original=>{const {default:Actual,...rest}=await original<typeof import('@/components/shared/condition-builder')>();return {...rest,default:(p:ComponentProps<typeof Actual>)=>{held.builder=p.onChange;return <Actual {...p}/>}}})
import {ConditionDialog} from './scenario-dialogs'
const condition={operator:'AND' as const,rules:[{type:'is_hidden' as const,value:false}],groups:[]}
const reason='閲覧のみのため配信条件を変えられません。'
const props={title:'配信対象',description:'条件を確認',value:condition,onSave:vi.fn(async()=>{}),onClose:vi.fn()}
const button=(name:string)=>screen.getByRole('button',{name,exact:true}) as HTMLButtonElement
beforeEach(()=>{held.buttons.clear();held.builder=null;held.reads.mockClear();props.onSave.mockClear();props.onClose.mockClear()})
afterEach(cleanup)

it('既知拒否でも窓/summary/候補GETを残し、保存/削除/初期化/保持builder変更は0',async()=>{
 const view=render(<ConditionDialog {...props} canChangeNow={()=>true}/>);await waitFor(()=>expect(held.reads).toHaveBeenCalledTimes(2));const save=held.buttons.get('この条件を反映')!,reset=held.buttons.get('条件を初期化')!,remove=held.buttons.get('削除する')!,update=held.builder!
 view.rerender(<ConditionDialog {...props} canChangeNow={()=>false} lockedReason={reason}/>);const apply=button('この条件を反映');expect(apply.disabled).toBe(false);expect(apply.getAttribute('aria-disabled')).toBe('true');expect(apply.tabIndex).toBe(0);for(const name of ['削除する','条件を初期化']){const control=button(name);expect(control.disabled).toBe(false);expect(control.getAttribute('aria-disabled')).toBe('true');expect(control.tabIndex).toBe(0)}expect((document.querySelector('fieldset[aria-label="条件の入力"]') as HTMLFieldSetElement).disabled).toBe(true);fireEvent.focus(apply);expect(screen.getByRole('tooltip').textContent).toBe(reason)
 fireEvent.click(button('削除する'));await act(async()=>{await save();await reset();await remove();update(null)});expect(props.onSave).not.toHaveBeenCalled();expect(props.onClose).not.toHaveBeenCalled();expect(screen.getByText('条件 1')).toBeTruthy();expect(screen.getByText('詳しい条件を編集')).toBeTruthy()
 fireEvent.click(button('キャンセル'));expect(props.onClose).toHaveBeenCalledOnce()
})

it('未知は理由なしnative disabled、保持save/updateも0、読む窓は残る',async()=>{
 const view=render(<ConditionDialog {...props} canChangeNow={()=>true}/>);const save=held.buttons.get('この条件を反映')!,update=held.builder!
 view.rerender(<ConditionDialog {...props} canChangeNow={()=>false}/>);expect(button('この条件を反映').disabled).toBe(true);expect(button('条件を初期化').disabled).toBe(true);expect(button('削除する').disabled).toBe(true);expect((document.querySelector('fieldset[aria-label="条件の入力"]') as HTMLFieldSetElement).disabled).toBe(true);expect(document.querySelector('[data-permission-locked]')).toBeNull()
 await act(async()=>{await save();update(null)});expect(props.onSave).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByText('条件 1')).toBeTruthy()
})

it('再描画の前に失効してもsave/update0',async()=>{
 let allowed=true;render(<ConditionDialog {...props} canChangeNow={()=>allowed}/>);const save=held.buttons.get('この条件を反映')!,update=held.builder!;allowed=false
 await act(async()=>{await save();update(null)});expect(props.onSave).not.toHaveBeenCalled();expect(screen.getByText('条件 1')).toBeTruthy()
})

it('新しいcallbackの描画後失効を古いsave/updateも読み直す',async()=>{
 let allowed=true;const view=render(<ConditionDialog {...props} canChangeNow={()=>true}/>);const save=held.buttons.get('この条件を反映')!,update=held.builder!
 view.rerender(<ConditionDialog {...props} canChangeNow={()=>allowed}/>);allowed=false
 await act(async()=>{await save();update(null)});expect(props.onSave).not.toHaveBeenCalled();expect(screen.getByText('条件 1')).toBeTruthy()
})

it('理由付きの古いsave/updateは理由が消えても復活せず、新しい保存は1',async()=>{
 const view=render(<ConditionDialog {...props} canChangeNow={()=>true} lockedReason={reason}/>);const save=held.buttons.get('この条件を反映')!,update=held.builder!
 view.rerender(<ConditionDialog {...props} canChangeNow={()=>true}/>);await act(async()=>{await save();update(null)});expect(props.onSave).not.toHaveBeenCalled();expect(screen.getByText('条件 1')).toBeTruthy()
 await act(async()=>{await held.buttons.get('この条件を反映')!()});expect(props.onSave).toHaveBeenCalledExactlyOnceWith(condition);expect(props.onClose).toHaveBeenCalledOnce()
})

it.each(['success-known','failure-known','success-unknown','failure-unknown'] as const)('保存中に失効したら窓/編集済下書きを保ち、busyを解く %s',async outcome=>{
 let finish!:()=>void;const onSave=vi.fn(()=>new Promise<void>((resolve,reject)=>{finish=()=>outcome.startsWith('success')?resolve():reject(new Error('late failure'))}));let allowed=true
 const view=render(<ConditionDialog {...props} onSave={onSave} canChangeNow={()=>allowed}/>);act(()=>held.builder!({...condition,rules:[...condition.rules,{type:'is_hidden',value:true}]}));let pending!:Promise<void>;act(()=>{pending=held.buttons.get('この条件を反映')!() as Promise<void>});expect(onSave).toHaveBeenCalledOnce()
 allowed=false;view.rerender(<ConditionDialog {...props} onSave={onSave} canChangeNow={()=>allowed} lockedReason={outcome.endsWith('known')&&!outcome.endsWith('unknown')?reason:undefined}/>);await act(async()=>{finish();await pending})
 expect(props.onClose).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByText('条件 1')).toBeTruthy();expect(screen.getByText('条件 2')).toBeTruthy();expect(screen.queryByText(/通信状態を確認/)).toBeNull();expect(button('キャンセル').disabled).toBe(false);expect(button('この条件を反映').getAttribute('aria-busy')).toBeNull();expect(screen.queryByText('保存中…')).toBeNull()
})

it('任意leaseの保存はsingleflight、未確定の重複を始めず完了で閉じるのは1回',async()=>{
 let finish!:()=>void;const onSave=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve}));render(<ConditionDialog {...props} onSave={onSave} canChangeNow={()=>true}/>);const save=held.buttons.get('この条件を反映')!;let pending!:Promise<void>
 act(()=>{pending=save() as Promise<void>});act(()=>{void save()});expect(onSave).toHaveBeenCalledOnce();await act(async()=>{finish();await pending});expect(props.onClose).toHaveBeenCalledOnce()
})

it('unmount後の保持saveは始めない',async()=>{
 const view=render(<ConditionDialog {...props} canChangeNow={()=>true}/>);const save=held.buttons.get('この条件を反映')!;view.unmount()
 await act(async()=>{await save()});expect(props.onSave).not.toHaveBeenCalled();expect(props.onClose).not.toHaveBeenCalled()
})

it('保存中のunmount後に成功しても別の窓を閉じない',async()=>{
 let finish!:()=>void;const onSave=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve}));const view=render(<ConditionDialog {...props} onSave={onSave} canChangeNow={()=>true}/>);let pending!:Promise<void>
 act(()=>{pending=held.buttons.get('この条件を反映')!() as Promise<void>});expect(onSave).toHaveBeenCalledOnce();view.unmount();await act(async()=>{finish();await pending});expect(props.onClose).not.toHaveBeenCalled()
})

it('明示disabledもcallback許可より先にsave/updateを止め、理由を作らない',async()=>{
 render(<ConditionDialog {...props} disabled canChangeNow={()=>true}/>);expect(button('この条件を反映').disabled).toBe(true)
 await act(async()=>{await held.buttons.get('この条件を反映')!();held.builder!(null)});expect(props.onSave).not.toHaveBeenCalled();expect(screen.getByText('条件 1')).toBeTruthy();expect(document.querySelector('[data-permission-locked]')).toBeNull()
})

it('許可された削除は赤色と縮まない形を保つ',()=>{
 render(<ConditionDialog {...props} canChangeNow={()=>true}/>);const remove=button('削除する');expect(remove.className).toContain('textDanger');expect(remove.className).toContain('shrink-0')
})

it('権限有効な保存失敗は再試行でき、2回目の成功で閉じる',async()=>{
 const onSave=vi.fn().mockRejectedValueOnce(new Error('first failure')).mockResolvedValueOnce(undefined);render(<ConditionDialog {...props} onSave={onSave} canChangeNow={()=>true}/>);
 await act(async()=>{await held.buttons.get('この条件を反映')!()});expect(screen.getByText(/条件を保存できませんでした/)).toBeTruthy();expect(button('この条件を反映').getAttribute('aria-busy')).toBeNull()
 await act(async()=>{await held.buttons.get('この条件を反映')!()});expect(onSave).toHaveBeenCalledTimes(2);expect(props.onClose).toHaveBeenCalledOnce()
})

it('保存中のunmount後にrejectしても別の窓を閉じない',async()=>{
 let fail!:(e:Error)=>void;const onSave=vi.fn(()=>new Promise<void>((_,reject)=>{fail=reject}));const view=render(<ConditionDialog {...props} onSave={onSave} canChangeNow={()=>true}/>);let pending!:Promise<void>
 act(()=>{pending=held.buttons.get('この条件を反映')!() as Promise<void>});view.unmount();await act(async()=>{fail(new Error('late'));await pending});expect(props.onClose).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull()
})
