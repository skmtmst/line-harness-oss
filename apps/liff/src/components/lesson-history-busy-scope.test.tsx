// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
const notifications=vi.hoisted(()=>new Map<string,(busy:boolean)=>void>());
vi.mock('../lib/api.js',()=>({api:{myEventBookings:vi.fn(),makeupCredits:vi.fn()}}));
vi.mock('./makeup-picker.js',()=>({default:({credit,onBusyChange}:{credit:{id:string};onBusyChange:(busy:boolean)=>void})=>{notifications.set(credit.id,onBusyChange);return <p>選んだ券 {credit.id}</p>;}}));
import LessonHistorySection from './lesson-history-section.js';
afterEach(()=>{cleanup();vi.resetAllMocks();notifications.clear();});
it('旧券の遅いfalse通知が、新券の送信中を解除しない',async()=>{
 vi.mocked(api.myEventBookings).mockResolvedValue({items:[]});
 vi.mocked(api.makeupCredits).mockResolvedValue({credits:[{id:'a',status:'open',expires_at:'2099-11-15T00:00:00Z'},{id:'b',status:'open',expires_at:'2099-11-30T00:00:00Z'}]});
 render(<LessonHistorySection creditsOnly/>);await screen.findByText('選んだ券 a');
 const old=notifications.get('a')!;
 const group=screen.getByRole('group',{name:'使う振替'});
 fireEvent.click(within(group).getByRole('button',{name:/11\/30/}));await screen.findByText('選んだ券 b');
 act(()=>notifications.get('b')!(true));expect(within(group).getAllByRole('button').every(button=>button.hasAttribute('disabled'))).toBe(true);
 act(()=>old(false));expect(within(group).getAllByRole('button').every(button=>button.hasAttribute('disabled'))).toBe(true);
 act(()=>notifications.get('b')!(false));expect(within(group).getAllByRole('button').every(button=>!button.hasAttribute('disabled'))).toBe(true);
});
