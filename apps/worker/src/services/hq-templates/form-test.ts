import { fieldsToLayout, validateAnswers } from '@line-crm/shared';
import { templateDetail, HqTemplateError } from './distribution.js';
import { parseFormTemplateDefinition } from './form.js';
import type { HqTemplateAuthority } from './contract.js';

/** Exercise the saved HQ definition with the same validator as the store, without sending or writing answers. */
export async function testHqForm(db: D1Database, authority: HqTemplateAuthority, id: string, input: Record<string,unknown>) {
  const {template,definition}=await templateDetail(db,authority,id);
  if(template.template_type!=='form')throw new HqTemplateError('INVALID_TYPE');
  if(input.expectedRevision!==undefined&&input.expectedRevision!==template.revision)throw new HqTemplateError('VERSION_CONFLICT',409);
  const parsed=parseFormTemplateDefinition({templateVersionId:template.current_version_id!,definitionJson:JSON.stringify(definition)});
  const layout=parsed.form.layout??fieldsToLayout(parsed.form.fields);
  if(input.answers!==undefined&&(!input.answers||typeof input.answers!=='object'||Array.isArray(input.answers)))throw new HqTemplateError('INVALID_ANSWERS');
  const validationError=input.answers===undefined?null:validateAnswers(layout,input.answers as Record<string,unknown>);
  return {dryRun:true,sent:0,persistsAnswers:false,templateId:id,templateVersionId:template.current_version_id,revision:template.revision,
    form:{name:parsed.form.name,description:parsed.form.description,fields:parsed.form.fields,layout},
    answerValidation:input.answers===undefined?null:{valid:validationError===null,error:validationError},
    testUrl:null,testUrlUnavailableReason:'HQ_TEST_TOKEN_STORAGE_REQUIRED'};
}
