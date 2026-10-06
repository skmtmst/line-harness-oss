// @vitest-environment happy-dom
import React from 'react';import {cleanup,render,screen} from '@testing-library/react';import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/use-admin-theme',()=>({useAdminTheme:()=> 'v8'}));
vi.mock('@/lib/api',()=>({ApiError:class extends Error {},api:{nenMembers:{photoPublications:async()=>({success:true,data:{summary:{publishedCount:1,placementCount:0,consentedCount:1,topPhoto:{pet_name:'Lifetime',view_count:9999},topPhoto30Days:{pet_name:'Recent',view_count_30_days:42}},items:[{id:'p',pet_name:'Recent',view_count:9999,view_count_30_days:42,placements:[]}],pendingWithdrawals:[],withdrawnItems:[]}})}}}));
import { PhotoPublications } from './photo-publications';
afterEach(cleanup);
it('shows the measured 30-day value instead of lifetime count',async()=>{
 render(<PhotoPublications accountId="a" onBack={()=>{}}/>);await screen.findByText('いちばん見られた（この30日）');
 expect(screen.queryByText(/9,999/)).toBeNull();expect(screen.getAllByText(/42/).length).toBeGreaterThan(0);
});
