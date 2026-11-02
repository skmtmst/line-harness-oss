// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WebinarApp } from '../../../worker/src/client/webinar/main.js';
vi.mock('@line/liff', () => ({ default: {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('コメントの通信失敗後も同じ識別子と時刻で再送する', async () => {
  const bodies: Array<Record<string,unknown>> = [];
  const session = Math.floor(Date.now()/1000)+300;
  vi.stubGlobal('fetch', vi.fn(async (_input:RequestInfo|URL, init?:RequestInit) => {
    if (init?.method === 'POST') {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(bodies.length===1 ? {error:'offline'} : {ok:true}), {status:bodies.length===1 ? 503:200});
    }
    return new Response(JSON.stringify({live:false,waiting:true,title:'見本',nextSessionAt:session,offsetSeconds:-300,comments:[]}));
  }));
  render(<WebinarApp slug="sample" ctx={{liffId:'l',lineUserId:'u',idToken:'t'}} />);
  fireEvent.change(await screen.findByRole('textbox',{name:'コメントを書く'}),{target:{value:'質問です'}});
  fireEvent.click(screen.getByRole('button',{name:'送信する'}));
  expect((screen.getByRole('textbox',{name:'コメントを書く'}) as HTMLInputElement).value).toBe('');
  fireEvent.click(await screen.findByRole('button',{name:'再送する'}));
  await waitFor(()=>expect(bodies).toHaveLength(2));
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0].requestId).toMatch(/^u-[0-9a-f-]{36}$/);
});
