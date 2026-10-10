import { expect, test } from 'vitest'
import { FIXED_FRIEND_FIELDS, emptyLayout } from '@line-crm/shared'
import { ADD_GROUPS } from './model'
import { hqFormEditorToDefinition, hqFormPortableReferenceError } from '@/components/forms/hq-form-definition-adapter'
test('store and HQ definitions keep all seven keys, full-width images and alternative text',()=>{
  const cards=ADD_GROUPS.flatMap(g=>g.cards)
  const blocks=['name','kana','birthday','age','contact','tel','address'].map((key,i)=>cards.find(c=>c.key===key)!.make(i))
  expect(blocks.map(b=>b.kind==='input'?b.fixedField:null)).toEqual(FIXED_FRIEND_FIELDS.map(f=>f.key))
  const image=cards.find(c=>c.key==='image')!.make(7)
  expect(image).toMatchObject({kind:'image',size:'full',alt:''})
  const value={name:'登録',description:'',layout:emptyLayout(),onSubmitTagId:'',onSubmitScenarioId:'',saveToMetadata:true}
  value.layout.sections[0].blocks=[...blocks,{...image,mediaUrl:'https://cdn.example.test/photo.png',alt:'案内の写真'} as typeof image]
  expect(hqFormPortableReferenceError(value)).toBeNull()
  expect(hqFormEditorToDefinition(value).form.layout).toMatchObject({sections:[{blocks:expect.arrayContaining([expect.objectContaining({fixedField:'birthday'}),expect.objectContaining({alt:'案内の写真'})])}]})
})
