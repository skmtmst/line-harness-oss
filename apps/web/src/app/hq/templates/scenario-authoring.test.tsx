// @vitest-environment happy-dom
import { afterEach,expect,test,vi } from 'vitest'
import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { useState } from 'react'
import TemplateDefinitionEditor,{definitionForName,freshDefinition,definitionError} from './template-definition-editor'
import type { TemplateDefinition } from '@/lib/hq-templates-api'
import { loadCreationAttempt,persistCreationAttempt } from '@/lib/hq-template-create-attempt'
afterEach(cleanup)
test('authors two ordered scenario steps and restores the entire unresolved save',()=>{
 let captured:TemplateDefinition=freshDefinition('scenario')
 function Harness(){const [value,setValue]=useState(definitionForName('scenario',captured,'案内','説明'));captured=value;return <TemplateDefinitionEditor type="scenario" value={value} disabled={false} onChange={setValue}/>}
 render(<Harness/>);
 fireEvent.change(screen.getByLabelText('ステップ1の本文'),{target:{value:'初日の案内'}});
 fireEvent.click(screen.getByRole('button',{name:'ステップを追加'}));
 fireEvent.change(screen.getByLabelText('ステップ2の本文'),{target:{value:'二日目の案内'}});
 fireEvent.change(screen.getByLabelText('ステップ2の遅延'),{target:{value:'1440'}});
 expect(definitionError('scenario',captured)).toBeNull();
 const scope={tenantId:'tenant-a',actorId:'owner'}, input={type:'scenario' as const,name:'案内',definition:captured as import('@line-crm/shared').HqScenarioDefinition};
 persistCreationAttempt(window.sessionStorage,scope,'scenario',{requestId:'request-scenario',input,distribute:false});
 expect(loadCreationAttempt(window.sessionStorage,scope,'scenario')?.input).toEqual(input);
});
