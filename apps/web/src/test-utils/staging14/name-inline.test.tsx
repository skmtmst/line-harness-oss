// @vitest-environment happy-dom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import InlineEdit from '../../components/shared/inline-edit';
afterEach(cleanup);
for (const status of [500,409]) it(`紹介者の名前保存失敗${status}で下書きを保つ`,async()=>{
 const save=vi.fn().mockRejectedValue(Object.assign(new Error('synthetic failure'),{status}));
 render(<InlineEdit value="元の名前" label="紹介者の名前を直す" onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'紹介者の名前を直すを変更する'}));
 const input=screen.getByRole('textbox',{name:'紹介者の名前を直す'}) as HTMLInputElement;
 fireEvent.change(input,{target:{value:'入力途中の名前'}}); fireEvent.keyDown(input,{key:'Enter'});
 await screen.findByRole('alert'); expect(save).toHaveBeenCalledWith('入力途中の名前');
 expect(input.value).toBe('入力途中の名前');
});
it('紹介者の名前保存成功は一度だけ送る',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);render(<InlineEdit value="元の名前" label="名前" onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'名前を変更する'}));
 const input=screen.getByRole('textbox',{name:'名前'}); fireEvent.change(input,{target:{value:'新しい名前'}});
 fireEvent.keyDown(input,{key:'Enter'}); await waitFor(()=>expect(screen.queryByRole('textbox')).toBeNull());
 expect(save).toHaveBeenCalledTimes(1);
});

it('失敗後のblur・外からの更新でも下書きを残し、再試行はその下書きを送る', async () => {
 const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
 const view = render(<InlineEdit value="元の名前" label="名前" onSave={save} />)
 fireEvent.click(screen.getByRole('button', { name: '名前を変更する' }))
 const input = screen.getByRole('textbox') as HTMLInputElement
 fireEvent.change(input, { target: { value: '書いた名前' } }); fireEvent.keyDown(input, { key: 'Enter' })
 await screen.findByRole('alert'); fireEvent.blur(input)
 view.rerender(<InlineEdit value="相手が保存した名前" label="名前" onSave={save} />)
 expect(input.value).toBe('書いた名前'); fireEvent.keyDown(input, { key: 'Enter' })
 await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
 expect(save.mock.calls).toEqual([['書いた名前'], ['書いた名前']])
})
it('falseの保存結果も失敗として下書きを残す', async () => {
 render(<InlineEdit value="元の名前" label="名前" onSave={async () => false} />)
 fireEvent.click(screen.getByRole('button', { name: '名前を変更する' }))
 const input = screen.getByRole('textbox') as HTMLInputElement
 fireEvent.change(input, { target: { value: '書いた名前' } }); fireEvent.keyDown(input, { key: 'Enter' })
 await screen.findByRole('alert'); expect(input.value).toBe('書いた名前')
})
