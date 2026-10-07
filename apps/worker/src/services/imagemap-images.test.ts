import {describe,it,expect,vi} from 'vitest';
import {prepareImagemapImages,IMAGEMAP_WIDTHS} from './imagemap-images.js';
import type {Env} from '../index.js';
vi.mock('./file-scan.js',()=>({checkMediaGate:vi.fn(async()=>({allowed:true})),checkKeyGate:vi.fn(async()=>({allowed:true}))}));
vi.mock('./media-metadata.js',()=>({imageDimensions:()=>({width:1040,height:520})}));
describe('イメージマップのR2画像',()=>{
 it('5種類の幅を実際に変換し、拡張子のないURLで保存する',async()=>{
  const transform=vi.fn();const put=vi.fn();const run=vi.fn();
  const env={DB:{prepare:()=>({bind:()=>({first:async()=>({id:'m',line_account_id:'a'}),run})})},IMAGES:{get:async()=>({size:4,arrayBuffer:async()=>new Uint8Array([137,80,78,71]).buffer}),put},CF_IMAGES:{input:()=>({transform:(options:unknown)=>{transform(options);return{output:async()=>({image:()=>new Uint8Array([137,80,78,71])})};}})}} as unknown as Env['Bindings'];
  const payload={imageUrl:'https://worker.example/images/source.png',tapAreas:[{x:0,y:0,width:100,height:100,actionType:'message',text:'予約'}]};
  const result=await prepareImagemapImages(env,payload,'a','https://worker.example');
  expect(result.baseSize).toEqual({width:1040,height:520});
  expect(transform.mock.calls.map(call=>call[0].width)).toEqual(IMAGEMAP_WIDTHS);
  expect(put.mock.calls.map(call=>call[0].split('/').at(-1))).toEqual(IMAGEMAP_WIDTHS.map(String));
  expect(run).toHaveBeenCalledTimes(5);
  expect(result.baseUrl).toMatch(/^https:\/\/worker.example\/images\/imagemaps\//);
 });
 it('変換が未設定や外部URLなら、画像1枚に置き換えず止める',async()=>{
  await expect(prepareImagemapImages({} as Env['Bindings'],{},'a','https://worker.example')).rejects.toThrow('未設定');
  await expect(prepareImagemapImages({CF_IMAGES:{}} as Env['Bindings'],{imageUrl:'https://external.example/x.png'},'a','https://worker.example')).rejects.toThrow('登録メディア');
 });
});
