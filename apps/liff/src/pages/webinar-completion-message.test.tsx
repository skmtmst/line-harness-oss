// @vitest-environment happy-dom
import { fireEvent, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FormSheet } from '../../../worker/src/client/webinar/main.js';
vi.mock('@line/liff', () => ({ default: {} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const cta = { id:'c', atSeconds:0, kind:'form' as const, title:'アンケート', body:null, buttonLabel:'開く', autoOpen:false, formId:'f', url:null };
const def = { id:'f', name:'見本', description:null, isActive:true, fields:[] };
it('移動先がない送信完了は、予約画面へ移動中と表示しない', () => {
  render(<FormSheet sheet={{cta,phase:'done',def}} ctx={{liffId:'l',lineUserId:'u',idToken:'t'}} onFunnelEvent={()=>{}} onClose={()=>{}} onSubmitted={()=>{}} />);
  expect(screen.getByText('回答を送信しました')).toBeTruthy();
  expect(screen.queryByText(/予約画面へ移動/)).toBeNull();
  expect(screen.getAllByRole('button',{name:'閉じる'}).length).toBeGreaterThan(0);
});
it('送信後メッセージとリンクを表示し、自動で移動しない', () => {
  const withMessage={...def,onSubmitMessageContent:'詳しいご案内はこちら https://example.com/help'};
  render(<FormSheet sheet={{cta,phase:'done',def:withMessage}} ctx={{liffId:'l',lineUserId:'u',idToken:'t'}} onFunnelEvent={()=>{}} onClose={()=>{}} onSubmitted={()=>{}} />);
  expect(screen.getByText(/詳しいご案内はこちら/)).toBeTruthy();
  expect(screen.getByRole('link',{name:'https://example.com/help'}).getAttribute('href')).toBe('https://example.com/help');
  expect(screen.queryByText(/予約画面へ移動/)).toBeNull();
  expect(screen.queryByRole('button',{name:/予約画面/})).toBeNull();
});

it('リンクを含む回答送信の成功でも自動遷移を予約しない', async () => {
  const withMessage={...def,onSubmitMessageContent:'案内 https://example.com/help'};
  const done=vi.fn();
  const timers=vi.spyOn(window,'setTimeout');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({success:true}),{status:200})));
  render(<FormSheet sheet={{cta,phase:'form',def:withMessage}} ctx={{liffId:'l',lineUserId:'u',idToken:'t'}} onFunnelEvent={()=>{}} onClose={()=>{}} onSubmitted={done} />);
  expect(screen.queryByText(/15分枠/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/回答を送信/}));
  await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
  expect(timers.mock.calls.some(([,delay])=>delay===900)).toBe(false);
});
it.each([
  '{"type":"bubble","body":{"text":"見本","url":"https://example.com"}}',
  '[{"type":"bubble","body":{}}]',
  '["one","two"]',
  '{{name}}さま、ご案内です',
  '認証はこちら {{auth_url:CHANNEL_ID}}',
])('未展開の案内は定型文に置き換える: %s', content => {
  render(<FormSheet sheet={{cta,phase:'done',def:{...def,onSubmitMessageContent:content}}} ctx={{liffId:'l',lineUserId:'u',idToken:'t'}} onFunnelEvent={()=>{}} onClose={()=>{}} onSubmitted={()=>{}} />);
  expect(screen.getByText('送信後のご案内は、配信元にお問い合わせください。')).toBeTruthy();
  expect(document.body.textContent).not.toContain(content);
  expect(screen.queryByRole('link')).toBeNull();
});
it('URLに続く句読点と文章をリンク先に含めない', () => {
  render(<FormSheet sheet={{cta,phase:'done',def:{...def,onSubmitMessageContent:'こちら https://example.com/help。ご確認ください'}}} ctx={{liffId:'l',lineUserId:'u',idToken:'t'}} onFunnelEvent={()=>{}} onClose={()=>{}} onSubmitted={()=>{}} />);
  expect(screen.getByRole('link',{name:'https://example.com/help'}).getAttribute('href')).toBe('https://example.com/help');
  expect(screen.getByText(/。ご確認ください/)).toBeTruthy();
});
