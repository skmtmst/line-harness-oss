// @vitest-environment happy-dom
import {render,screen,waitFor,cleanup,fireEvent} from '@testing-library/react';
import {test,expect,vi,afterEach} from 'vitest';
const net=vi.hoisted(()=>({list:vi.fn()}));
vi.mock('@/lib/api',()=>({api:{entryRoutes:{list:net.list}}}));
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'synthetic-account',selectedAccount:{channelId:'synthetic',displayName:'Synthetic'}})}));
vi.mock('@/lib/use-same-page-url',()=>({useSamePageUrl:()=>({replace:vi.fn()})}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/components/dashboard/qr-dialog',()=>({default:()=>null}));
vi.mock('@/components/shared/copy-text-button',()=>({default:()=> <span>Copy boundary</span>}));
vi.mock('@/components/shared/entity-select',()=>({entityOptionMetadata:()=>({}),default:({options}:any)=><select aria-label="routes">{options.map((o:any)=><option key={o.value} value={o.value}>{o.label}</option>)}</select>}));
vi.mock('@/components/shared/save-form-errors',()=>({SaveErrorField:({children}:any)=>children}));
vi.mock('@/components/shared/button',()=>({default:({children,...p}:any)=><button {...p}>{children}</button>}));
vi.mock('@/v8/dashboard/head',()=>({default:()=> <h2>Friend link</h2>}));
import {FriendAddLink} from '@/v8/dashboard/friend-add';
afterEach(()=>{cleanup();vi.clearAllMocks()});
test('OPSDASH-F01 rejected list shows failure and retry reads routes again',async()=>{
 net.list.mockRejectedValueOnce(Error('synthetic offline')).mockResolvedValue({success:true,data:[]});
 render(<FriendAddLink officialProfileUrl={null} canManage={false}/>);
 expect(await screen.findByText('経路を読み込めませんでした')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:/もう一度/}));
 await waitFor(()=>expect(net.list).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.queryByText('経路を読み込めませんでした')).toBeNull());
 expect(screen.getAllByRole('option')).toHaveLength(1);
});
