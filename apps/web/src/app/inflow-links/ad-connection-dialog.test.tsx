// @vitest-environment happy-dom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
const calls=vi.hoisted(()=>({create:vi.fn(),update:vi.fn(),connect:vi.fn()}));
vi.mock('@/lib/api',()=>({api:{adPlatforms:calls}}));
import AdConnectionDialog from './ad-connection-dialog';
afterEach(cleanup);
it('保存後に疎通確認し、失敗を接続済みとして閉じない',async()=>{
 calls.create.mockResolvedValue({success:true,data:{id:'p'}});calls.connect.mockResolvedValue({success:false});const closed=vi.fn(),saved=vi.fn(async()=>{});
 render(<AdConnectionDialog provider={{key:'meta',label:'Meta広告'}} accountId="a" onClose={closed} onSaved={saved}/>);
 for(const label of ['広告アカウントID','ピクセルID','アクセストークン']) fireEvent.change(screen.getByLabelText(label),{target:{value:'synthetic'}});
 fireEvent.click(screen.getByRole('button',{name:'接続を確認してつなぐ'}));
 await waitFor(()=>expect(calls.connect).toHaveBeenCalledWith('p'));
 await screen.findByRole('alert');expect(closed).not.toHaveBeenCalled();
 expect(calls.create).toHaveBeenCalledWith(expect.objectContaining({lineAccountId:'a',config:expect.objectContaining({access_token:'synthetic'})}));
});
