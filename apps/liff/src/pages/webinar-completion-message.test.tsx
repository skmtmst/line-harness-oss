// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FormSheet } from '../../../worker/src/client/webinar/main.js';
vi.mock('@line/liff', () => ({ default: {} }));
afterEach(cleanup);
const cta = { id:'c', atSeconds:0, kind:'form' as const, title:'アンケート', body:null, buttonLabel:'開く', autoOpen:false, formId:'f', url:null };
const def = { id:'f', name:'見本', description:null, isActive:true, fields:[] };
it('移動先がない送信完了は、予約画面へ移動中と表示しない', () => {
  render(<FormSheet sheet={{cta,phase:'done',def}} ctx={{liffId:'l',lineUserId:'u',idToken:'t'}} onFunnelEvent={()=>{}} onClose={()=>{}} onSubmitted={()=>{}} />);
  expect(screen.getByText('回答を送信しました')).toBeTruthy();
  expect(screen.queryByText(/予約画面へ移動/)).toBeNull();
  expect(screen.getAllByRole('button',{name:'閉じる'}).length).toBeGreaterThan(0);
});
