// @vitest-environment happy-dom
import {afterEach,expect,it} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import MediaThumbnail from './media-thumbnail'
afterEach(cleanup)

it('大きさの指定なしは元の画像と失敗時の文字を保つ',()=>{
 const view=render(<MediaThumbnail kind="image" src="/sample.png" alt="商品" />)
 const image=screen.getByRole('img',{name:'商品'})
 expect(image.getAttribute('width')).toBe('160');expect(image.getAttribute('height')).toBe('120')
 fireEvent.error(image);expect(screen.getByText('画像を表示できません')).toBeTruthy()
 view.rerender(<MediaThumbnail kind="image" src="/next.png" alt="次の商品" />)
 expect(screen.getByRole('img',{name:'次の商品'}).getAttribute('src')).toBe('/next.png')
})
it('小さい画像なしと読取失敗は代わりの絵にし、新しい画像で復帰する',()=>{
 const view=render(<MediaThumbnail kind="image" size="compact" src="" alt="" />)
 expect(screen.getByRole('img',{name:'画像なし'}).getAttribute('data-size')).toBe('compact')
 expect(view.container.querySelector('img')).toBeNull()
 view.rerender(<MediaThumbnail kind="image" size="compact" src="/sample.png" alt="" />)
 fireEvent.error(view.container.querySelector('img')!)
 expect(screen.getByRole('img',{name:'画像を表示できません'})).toBeTruthy()
 view.rerender(<MediaThumbnail kind="image" size="compact" src="/next.png" alt="次の商品" />)
 expect(screen.getByRole('img',{name:'次の商品'}).tagName).toBe('IMG')
})
it('指定なしの動画とファイルの代わりの表示を保つ',()=>{
 const view=render(<MediaThumbnail kind="video" src="/sample.mp4" alt="動画" />)
 expect(screen.getByRole('img',{name:'動画'}).getAttribute('data-kind')).toBe('video')
 expect(screen.getByRole('img',{name:'動画'}).hasAttribute('data-size')).toBe(false)
 view.rerender(<MediaThumbnail kind="file" src="/sample.pdf" alt="資料" />)
 expect(screen.getByRole('img',{name:'資料'}).getAttribute('data-kind')).toBe('file')
})
