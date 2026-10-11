// @vitest-environment happy-dom
import {afterEach, expect, test, vi} from 'vitest'
import {cleanup, render, screen, within} from '@testing-library/react'
import {BASIC_FRIEND_FIELDS} from '@line-crm/shared'
import InfoTab from './info-tab'
vi.mock('@/components/shared/list-navigation',()=>({default:({children,...props}:React.ComponentProps<'a'>)=><a {...props}>{children}</a>}))
afterEach(cleanup)
test('基本8欄は先頭、古い名前を読み替え、店の欄を分類し、出どころと満年齢を示す',()=>{
 const fields=[...BASIC_FRIEND_FIELDS.map(spec=>({id:spec.key,name:spec.key==='name'?'本名':spec.key==='birthday'?'誕生日':spec.label,fixedKey:spec.key,folderId:null,type:spec.key==='birthday'?'date':'text',value:spec.key==='birthday'?'2000-01-01':spec.key==='name'?'山田':null})),{id:'pet',name:'ペットの名前',type:'text',folderId:'pets',value:'もも'},{id:'anniversary',name:'記念日',type:'date',fixedKey:'anniversary',value:'2026-01-01'}];
 const data={fields,values:Object.fromEntries(fields.map(field=>[field.id,field.value??''])),fieldsStatus:'ready',fieldFolders:[{id:'pets',name:'ペット'}],fieldFoldersStatus:'ready',hiddenPersonalCount:0,warnings:[],setValues:vi.fn()};
 render(<InfoTab friendId="f" group="all" data={data as never} perms={{canEditField:()=>false} as never}/>);
 const basics=screen.getByRole('region',{name:'基本'});
 for(const spec of BASIC_FRIEND_FIELDS) expect(within(basics).getByText(spec.key==='birthday'?/生年月日（\d+歳）/:spec.label)).toBeTruthy();
 expect(screen.queryByText('本名')).toBeNull();expect(screen.queryByText('誕生日')).toBeNull();
 expect(within(basics).getAllByText('手で入れた').length).toBeGreaterThan(0);
 expect(screen.getByRole('region',{name:'お店が作った項目（ペット）'})).toBeTruthy();expect(screen.getByRole('region',{name:'飲食の情報'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'保存する'})).toBeNull();expect(screen.queryByRole('button',{name:'＋ 足す'})).toBeNull();
})
