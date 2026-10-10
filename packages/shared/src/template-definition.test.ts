import { expect, test } from 'vitest'
import { TEMPLATE_KINDS, templateKind, type MessageTemplateDefinition } from './template-definition'
test('rich video is a template kind and uses the same imagemap type as store templates',()=>{
  const definition = {template:{messageType:'imagemap'}} as MessageTemplateDefinition
  expect(TEMPLATE_KINDS).toContain('rich_video')
  expect(templateKind(definition)).toBe('rich_video')
})
