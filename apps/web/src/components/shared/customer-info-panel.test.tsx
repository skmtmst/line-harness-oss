// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '@/lib/api'
import { BASIC_FRIEND_FIELDS as FIXED_FRIEND_FIELDS, type FriendField } from '@line-crm/shared'
import CustomerInfoPanel from './customer-info-panel'
import { fixedFieldValue } from './fixed-friend-field-values'
vi.mock('next/link', () => ({default:({children,...props}: React.ComponentProps<'a'>)=><a {...props}>{children}</a>}))
vi.mock('@/lib/api', () => ({api:{friendFields:{saveForFriend:vi.fn()}}}))
const fields = FIXED_FRIEND_FIELDS.map((spec,index) => ({
  id:spec.key, name:spec.label, fixedKey:spec.key, type:'text', isPersonal:true, value:spec.key==='birthday'?'2000-01-01':spec.key==='age'?'18':spec.key==='name'?'山田花子':null,
  valueSource:spec.key==='birthday'?{type:'form',id:'form',name:'登録'}:null,
  valueUpdatedAt:'2026-10-08T10:12:00+09:00', displayOrder:index,
})) as FriendField[]
const storage = new Map<string, string>()
beforeEach(() => {
  vi.mocked(api.friendFields.saveForFriend).mockReset()
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('birthday takes priority, fallback age and source match the displayed value',()=>{
  expect(fixedFieldValue(fields,'age',new Date('2026-10-10T00:00:00Z'))).toMatchObject({value:'26',derived:true})
  expect(fixedFieldValue(fields,'age').source).toContain('回答フォーム『登録』から 10/08 10:12')
  expect(fixedFieldValue(fields.filter(f=>f.fixedKey!=='birthday'),'age')).toEqual({value:'18',derived:false,source:'手で入れた'})
})
test('eight visible basics, shared display preferences persist only after save',()=>{
  const props={friendId:'f',fields,state:'ready' as const,canEdit:true,sections:[{key:'tags',label:'タグ',content:<p>VIP</p>}]}
  const first=render(<CustomerInfoPanel {...props}/>)
  for(const spec of FIXED_FRIEND_FIELDS) expect(screen.getByText(spec.label)).toBeTruthy()
  expect(screen.getByRole('button',{name:'編集'})).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'表示項目'}))
  fireEvent.click(screen.getByRole('checkbox',{name:'タグ'}))
  fireEvent.click(screen.getByRole('button',{name:'保存する'}))
  expect(JSON.parse(localStorage.getItem('chat.friendInfoSections.v4')!).hidden).toContain('tags')
  first.unmount()
  render(<CustomerInfoPanel {...props} canEdit/>)
  expect(screen.getByRole('button', {name:'編集'})).toBeTruthy()
  expect(screen.queryByText('VIP')).toBeNull()
})
test('failed fetch is shown with retry instead of unregistered values',()=>{
  const onRetry=vi.fn()
  render(<CustomerInfoPanel friendId="f" fields={[]} state="error" canEdit={false} sections={[]} onRetry={onRetry}/>)
  expect(screen.queryByText('未登録')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'もう一度読み込む'}))
  expect(onRetry).toHaveBeenCalledOnce()
})

test('個々の基本欄と追加の節を隠せ、閉じても別画面へ設定を引き継ぐ', () => {
  const props = { friendId: 'f', fields, state: 'ready' as const, canEdit: true, sections: [], extraSections: [{ key: 'forms', label: 'フォーム回答', content: <p>回答履歴</p> }] };
  const first = render(<CustomerInfoPanel {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '表示項目' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'メール' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'フォーム回答' }));
  fireEvent.click(screen.getByRole('button', { name: '保存する' }));
  first.unmount();
  render(<CustomerInfoPanel {...props} />);
  expect(screen.queryByText('メール')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '顧客情報をすべて表示' }));
  expect(screen.queryByText('回答履歴')).toBeNull();
});

test('基本の編集は取消で送らず、失敗では値を保ち、保存した値だけ送る', async () => {
  render(<CustomerInfoPanel friendId="f" fields={fields} state="ready" canEdit sections={[]} />)
  fireEvent.click(screen.getByRole('button',{name:'編集'}))
  fireEvent.change(screen.getByRole('textbox',{name:'名前'}),{target:{value:'変更した名前'}})
  fireEvent.click(screen.getByRole('button',{name:'キャンセル'}))
  expect(api.friendFields.saveForFriend).not.toHaveBeenCalled()
  expect(screen.getByText('山田花子')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'編集'}))
  fireEvent.change(screen.getByRole('textbox',{name:'名前'}),{target:{value:'新しい名前'}})
  vi.mocked(api.friendFields.saveForFriend).mockResolvedValueOnce({success:false,error:'保存失敗'} as never)
  fireEvent.click(screen.getByRole('button',{name:'保存する'}))
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('保存失敗'))
  expect((screen.getByRole('textbox',{name:'名前'}) as HTMLInputElement).value).toBe('新しい名前')
  vi.mocked(api.friendFields.saveForFriend).mockResolvedValueOnce({success:true} as never)
  fireEvent.click(screen.getByRole('button',{name:'保存する'}))
  await waitFor(()=>expect(screen.getByText('新しい名前')).toBeTruthy())
  expect(api.friendFields.saveForFriend).toHaveBeenLastCalledWith('f',{name:'新しい名前'})
})

test('既存の並びを保ち、上下キーの変更を保存する。顧客の値は手元へ保存しない', () => {
  localStorage.setItem('chat.friendInfoSections.v4', JSON.stringify({ order: ['tags', 'support'], hidden: [] }));
  render(<CustomerInfoPanel friendId="f" fields={fields} state="ready" canEdit sections={[
    { key: 'support', label: '対応', content: '対応内容' }, { key: 'tags', label: 'タグ', content: 'タグ内容' },
  ]} />);
  fireEvent.click(screen.getByRole('button', { name: '表示項目' }));
  fireEvent.keyDown(screen.getByRole('button', { name: /対応.*並び/ }), { key: 'ArrowUp' });
  fireEvent.click(screen.getByRole('button', { name: '保存する' }));
  const saved = localStorage.getItem('chat.friendInfoSections.v4')!;
  expect(JSON.parse(saved).order.slice(0,2)).toEqual(['support', 'tags']);
  expect(saved).not.toContain('山田花子');
});

test('閲覧のみでは基本の編集と表示項目の変更を出さない',()=>{
 render(<CustomerInfoPanel friendId="f" fields={fields} state="ready" canEdit={false} sections={[]}/>);
 expect(screen.queryByRole('button',{name:'編集'})).toBeNull();expect(screen.queryByRole('button',{name:'表示項目'})).toBeNull();
})
