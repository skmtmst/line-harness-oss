// @vitest-environment happy-dom
import {cleanup,render,screen} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import {INITIAL_MENUS,initialMenuBounds} from '@line-crm/shared'
import {SampleMenuTiles} from './sample-menu'
afterEach(cleanup)
const buttons=INITIAL_MENUS.restaurant.buttons.map((button,index)=>({...button,bounds:initialMenuBounds(index)}))
it('同じ4面のラベルでも、保存済み画像が無いときは新しい見本の絵で補わない',()=>{
 const {container}=render(<SampleMenuTiles style="restaurant" buttons={buttons} imageUrl={null}/>);
 expect((container.firstElementChild as HTMLElement).style.backgroundImage).toBe('');
 expect(screen.getByText('予約の確認と変更')).toBeTruthy();
})
it('保存済み画像はその画像を使い、実際の座標に操作を重ねる',()=>{
 const {container}=render(<SampleMenuTiles style="restaurant" buttons={buttons} imageUrl="https://example.test/own.png" onSelect={()=>{}}/>);
 expect((container.firstElementChild as HTMLElement).style.backgroundImage).toContain('https://example.test/own.png');
 expect((screen.getByRole('button',{name:'アクセス'}) as HTMLButtonElement).style).toMatchObject({position:'absolute',left:'50%',top:'50%',width:'50%',height:'50%'});
})
