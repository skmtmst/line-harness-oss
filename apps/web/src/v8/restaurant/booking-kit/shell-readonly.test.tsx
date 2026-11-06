// @vitest-environment happy-dom
import React from 'react';
import {render,screen,cleanup} from '@testing-library/react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const fx=vi.hoisted(()=>({snapshot:vi.fn(),listStores:vi.fn(),storeContext:vi.fn(),channelCloseTasks:vi.fn(),reservationsDay:vi.fn(),customerHistory:vi.fn(),openingHours:vi.fn()}));
vi.mock('@/lib/restaurant-test-api',()=>({restaurantTestApi:fx}));
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'fixture-account',accounts:[]})}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn(),prefetch:vi.fn()}),usePathname:()=>'/restaurant-test',useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{}}));
vi.mock('@/lib/staff-role',()=>({useStaffRole:()=> 'owner',canManageRole:()=>true}));
vi.mock('@/components/shared/toast',()=>({notifySaved:vi.fn(),notifyToast:vi.fn(),notifyError:vi.fn()}));
import Shell from '@/v8/restaurant/booking-kit/shell';
import {snapshotOf} from '@/v8/restaurant/booking-kit/test-data';
import {rememberStaffIdentity,forgetStaffIdentity} from '@/lib/staff-identity-state';
import type {StaffMember} from '@line-crm/shared';
beforeEach(()=>{vi.clearAllMocks();rememberStaffIdentity({role:'viewer'} as StaffMember);fx.snapshot.mockResolvedValue({data:snapshotOf()});fx.storeContext.mockResolvedValue({data:{}});fx.customerHistory.mockResolvedValue({data:{visitCount:0,visits:[]}})});
afterEach(()=>{cleanup();forgetStaffIdentity()});
it('templateHeading の帯は見出しと操作の行の下に1つだけ置く',async()=>{
  const {container,unmount}=render(<Shell templateHeading boundary={false} boardId="fixture" title="在庫の設定" description="店舗の在庫を確認できます" readOnly readOnlyNeed="manager" headAfter={()=><button type="button">保存する</button>} />);
  await screen.findByRole('heading',{name:'在庫の設定'});
  const header=container.querySelector('header[data-template-region="heading"]');
  const notices=container.querySelectorAll('[data-read-only-notice]');
  expect(notices.length).toBe(1);
  expect(header?.closest('[data-page-template]')?.getAttribute('data-page-template')).toBe('restaurant');
  expect(notices[0].closest('[data-template-region="notice"]')?.parentElement).toBe(header);
  unmount();
});
it('従来の頭の帯は題の列の中に残す',async()=>{
  const {container,unmount}=render(<Shell boundary={false} boardId="fixture" title="在庫の設定" description="店舗の在庫を確認できます" readOnly readOnlyNeed="manager" headAfter={()=><button type="button">保存する</button>} />);
  await screen.findByRole('heading',{name:'在庫の設定'});
  const header=container.querySelector('header[data-template-region="heading"]');
  const notice=header?.querySelector('[data-template-region="notice"]');
  expect(notice).toBeTruthy();
  expect(notice?.parentElement).not.toBe(header);
  unmount();
});
