// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FIXED_FRIEND_FIELDS, type FriendField } from '@line-crm/shared'
import CustomerInfoPanel from './customer-info-panel'
import { fixedFieldValue } from './fixed-friend-field-values'
vi.mock('next/link', () => ({default:({children,...props}: React.ComponentProps<'a'>)=><a {...props}>{children}</a>}))
const fields = FIXED_FRIEND_FIELDS.map((spec,index) => ({
  id:spec.key, name:spec.label, fixedKey:spec.key, type:'text', isPersonal:true, value:spec.key==='birthday'?'2000-01-01':spec.key==='age'?'18':spec.key==='name'?'山田花子':null,
  valueSource:spec.key==='birthday'?{type:'form',id:'form',name:'登録'}:null,
  valueUpdatedAt:'2026-10-08T10:12:00+09:00', displayOrder:index,
})) as FriendField[]
const storage = new Map<string, string>()
beforeEach(() => {
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
  expect(fixedFieldValue(fields.filter(f=>f.fixedKey!=='birthday'),'age')).toEqual({value:'18',derived:false,source:null})
})
test('seven visible basics, view-only edits hidden, shared display preferences persist',()=>{
  const props={friendId:'f',fields,state:'ready' as const,canEdit:false,sections:[{key:'tags',label:'タグ',content:<p>VIP</p>}]}
  const first=render(<CustomerInfoPanel {...props}/>)
  for(const spec of FIXED_FRIEND_FIELDS) expect(screen.getByText(spec.label)).toBeTruthy()
  expect(screen.queryByText('編集する')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'表示項目'}))
  fireEvent.click(screen.getByRole('checkbox',{name:'タグ'}))
  expect(JSON.parse(localStorage.getItem('chat.friendInfoSections.v4')!).hidden).toContain('tags')
  first.unmount()
  render(<CustomerInfoPanel {...props} canEdit/>)
  expect(screen.getByText('編集する')).toBeTruthy()
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
  const props = { friendId: 'f', fields, state: 'ready' as const, canEdit: false, sections: [], extraSections: [{ key: 'forms', label: 'フォーム回答', content: <p>回答履歴</p> }] };
  const first = render(<CustomerInfoPanel {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '表示項目' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'メール' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'フォーム回答' }));
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
  first.unmount();
  render(<CustomerInfoPanel {...props} />);
  expect(screen.queryByText('メール')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '顧客情報をすべて表示' }));
  expect(screen.queryByText('回答履歴')).toBeNull();
});

test('既存の並びを保ち、上下キーの変更を保存する。顧客の値は手元へ保存しない', () => {
  localStorage.setItem('chat.friendInfoSections.v4', JSON.stringify({ order: ['tags', 'support'], hidden: [] }));
  render(<CustomerInfoPanel friendId="f" fields={fields} state="ready" canEdit={false} sections={[
    { key: 'support', label: '対応', content: '対応内容' }, { key: 'tags', label: 'タグ', content: 'タグ内容' },
  ]} />);
  fireEvent.click(screen.getByRole('button', { name: '表示項目' }));
  fireEvent.keyDown(screen.getByRole('button', { name: /対応.*並び/ }), { key: 'ArrowUp' });
  const saved = localStorage.getItem('chat.friendInfoSections.v4')!;
  expect(JSON.parse(saved).order).toEqual(['support', 'tags']);
  expect(saved).not.toContain('山田花子');
});
