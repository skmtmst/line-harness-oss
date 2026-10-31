// @vitest-environment happy-dom
import { cleanup,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { MemoryRouter,Routes,Route } from 'react-router-dom';
import Form from './form.js';
const net=vi.hoisted(()=>({getForm:vi.fn(),getMyLatestFormAnswer:vi.fn(),submitForm:vi.fn(),resolveFormBookingRouting:vi.fn(),liffConfig:vi.fn().mockResolvedValue({success:true,data:{}})}));
vi.mock('../lib/api.js',()=>({api:net}));
vi.mock('../lib/liff-runtime.js',()=>({default:{closeWindow:vi.fn()}}));
afterEach(cleanup);
it('公開の案内は全ページの説明だけを表示し、入力・送信・前の回答の復元をしない',async()=>{
 net.getForm.mockResolvedValue({id:'info',name:'アクセス',isActive:true,layout:{version:2,header:[],sections:[{id:'one',name:'アクセス',blocks:[{id:'text',kind:'text',text:'駅から歩いて5分'},{id:'name',kind:'input',type:'text',name:'name',label:'お名前'},{id:'booking',kind:'input',type:'booking',name:'booking',label:'予約',booking:{kind:'people',menuId:'menu',routing:{enabled:true}}}]},{id:'two',name:'営業時間',blocks:[{id:'hours',kind:'text',text:'10時から18時まで'}]}],options:{restorePrevious:true}}});
 render(<MemoryRouter initialEntries={['/information/info?test_token=ignored']}><Routes><Route path="/information/:id" element={<Form readOnlyDocument/>}/></Routes></MemoryRouter>);
 await waitFor(()=>expect(screen.getByText('駅から歩いて5分')).toBeTruthy());expect(screen.getByText('10時から18時まで')).toBeTruthy();
 expect(screen.queryByRole('textbox')).toBeNull();expect(screen.queryByRole('button',{name:/送信|次へ/})).not.toBeTruthy();
 expect(net.getForm).toHaveBeenCalledWith('info',undefined);expect(net.getMyLatestFormAnswer).not.toHaveBeenCalled();expect(net.submitForm).not.toHaveBeenCalled();expect(net.resolveFormBookingRouting).not.toHaveBeenCalled();
});
