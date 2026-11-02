// @vitest-environment happy-dom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PartyMenuStep from './party-step.js';
import { api, type MenuItem } from '../lib/api.js';
import { initialParty, resize } from '../lib/party.js';
vi.mock('../lib/api.js', () => ({ api: { menus: vi.fn(), addons: vi.fn() } }));
const base: MenuItem = { id:'base', name:'基本', category_label:null, description:null, base_price:1000, duration_minutes:30, buffer_after_minutes:0, sort_order:0, max_party_size:3, addons:[] };
const other = { ...base, id:'other', name:'別のメニュー' };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('人数上限1のメニューに追加項目があっても、2人以上を選べない', () => {
  render(<PartyMenuStep menu={{...base,max_party_size:1}} party={initialParty()} onParty={vi.fn()} onChangeMenu={vi.fn()} />);
  expect(screen.queryByRole('button', { name:'2 人' })).toBeNull();
});
it('別メニューの追加項目を読み込み、成功するまで選択しない', async () => {
  vi.mocked(api.menus).mockResolvedValue({menus:[other]});
  let finish!: (value: any) => void;
  vi.mocked(api.addons).mockImplementation(() => new Promise(resolve => { finish=resolve; }));
  function Subject() { const [party,setParty]=useState(resize(initialParty(),2)); return <PartyMenuStep menu={base} party={party} onParty={setParty} onChangeMenu={()=>{}} />; }
  render(<Subject />);
  fireEvent.click(screen.getByRole('radio', {name:/別のメニューを選ぶ/}));
  fireEvent.click(await screen.findByRole('button', {name:/別のメニュー 30 分/}));
  expect(await screen.findByText(/追加メニューを読み込んでいます/)).toBeTruthy();
  expect(screen.queryByRole('checkbox', {name:/追加項目/})).toBeNull();
  await act(async()=>finish([{id:'a',name:'追加項目',price:200,duration_minutes:10}]));
  expect(await screen.findByRole('checkbox', {name:/追加項目/})).toBeTruthy();
  expect(api.addons).toHaveBeenCalledWith('other');
});
it('別メニューの追加項目の失敗を知らせ、再試行して選べる', async () => {
  vi.mocked(api.menus).mockResolvedValue({ menus:[other] });
  vi.mocked(api.addons).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{id:'a',name:'追加項目',price:200,duration_minutes:10}]);
  function Subject() { const [party,setParty]=useState(resize(initialParty(),2)); return <PartyMenuStep menu={base} party={party} onParty={setParty} onChangeMenu={()=>{}} />; }
  render(<Subject />);
  fireEvent.click(screen.getByRole('radio', {name:/別のメニューを選ぶ/}));
  fireEvent.click(await screen.findByRole('button', {name:/別のメニュー 30 分/}));
  expect((await screen.findByRole('alert')).textContent).toContain('追加メニューを読み込めませんでした');
  fireEvent.click(screen.getByRole('button', {name:'もう一度'}));
  expect(await screen.findByRole('checkbox', {name:/追加項目/})).toBeTruthy();
});
