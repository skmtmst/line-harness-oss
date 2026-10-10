import { expect, test } from 'vitest';
import { researchFormLayout } from './research-form.js';
import { validateAnswers } from './form-layout.js';
test('1つ選ぶ・複数選ぶ・自由入力を既存フォームと同じ検証に渡す', () => {
 const layout=researchFormLayout('r1',1,'調査',{questions:[{text:'ペット',format:'single',required:true,choices:['犬','猫']},{text:'食事',format:'multiple',required:true,choices:['朝','夜']},{text:'お名前',format:'free',required:true}]});
 expect(validateAnswers(layout,{question_1:'犬',question_2:['朝','夜'],question_3:'佐藤'})).toBeNull();
 expect(validateAnswers(layout,{question_1:'鳥',question_2:['朝'],question_3:'佐藤'})).toBeTruthy();
 expect(validateAnswers(layout,{question_1:'犬',question_2:[],question_3:''})).toBeTruthy();
});
test.each([{questions:[]},{questions:[{text:'選択',format:'single',required:true,choices:[]}]},{questions:[{text:'質問',format:'free',required:true}],startsAt:'2026-10-09T10:00',endsAt:'2026-10-09T09:00'},{questions:[{text:'質問',format:'free',required:true}],answerActions:[{actionType:'unknown',config:{}}]}])('実行できない質問・期間・動作を受け付けない %#', payload => {
 expect(()=>researchFormLayout('r1',1,'調査',payload)).toThrow();
});
