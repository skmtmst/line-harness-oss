import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

function unsafeConsoleCalls(source: string): number[] {
  const file=ts.createSourceFile('security-source.ts',source,ts.ScriptTarget.Latest,true);
  const failures:number[]=[];
  function binding(name:string,at:ts.Node):ts.Expression|undefined {
    for(let ancestor:ts.Node|undefined=at;ancestor;ancestor=ancestor.parent) if(ts.isBlock(ancestor)||ts.isSourceFile(ancestor)) {
      for(const statement of ancestor.statements) if(ts.isVariableStatement(statement)) for(const declaration of statement.declarationList.declarations)
        if(ts.isIdentifier(declaration.name)&&declaration.name.text===name)return declaration.initializer;
    }
  }
  function constantCode(node:ts.Expression,at:ts.Node,depth=0):boolean {
    if(depth>5)return false;
    if(ts.isStringLiteral(node))return true;
    if(ts.isConditionalExpression(node))return constantCode(node.whenTrue,at,depth+1)&&constantCode(node.whenFalse,at,depth+1);
    if(ts.isIdentifier(node)){const value=binding(node.text,at);return !!value&&constantCode(value,at,depth+1);}
    return false;
  }
  function safeRoute(node:ts.Expression,at:ts.Node,depth=0):boolean {
    if(depth>5)return false;
    if(ts.isStringLiteral(node))return !node.text.includes('?');
    if(ts.isPropertyAccessExpression(node)&&node.name.text==='routePath')return true;
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.BarBarToken)return safeRoute(node.left,at,depth+1)&&safeRoute(node.right,at,depth+1);
    if(ts.isIdentifier(node)){const value=binding(node.text,at);return !!value&&safeRoute(value,at,depth+1);}
    if(ts.isTemplateExpression(node))return node.templateSpans.every(span=>safeRoute(span.expression,at,depth+1));
    // HTTP methods can be printed only after narrowing to a closed set of fixed verbs.
    if(ts.isConditionalExpression(node)&&ts.isStringLiteral(node.whenFalse)&&node.whenFalse.text==='OTHER') {
      return node.condition.getText(file)==="/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(c.req.method)";
    }
    return false;
  }
  // 共通serializerだけは、自由な文を含まない厳密な構造と採番元を検査する。
  function safeEnvelope(node:ts.Expression,at:ts.Node):boolean {
    if(ts.isIdentifier(node)){const value=binding(node.text,at);return !!value&&safeEnvelope(value,at);}
    if(!ts.isObjectLiteralExpression(node))return false;
    const fields=new Map<string,string>();
    for(const property of node.properties){
      if(ts.isSpreadAssignment(property)){
        const expression=ts.isParenthesizedExpression(property.expression)?property.expression.expression:property.expression;
        const text=expression.getText(file).replace(/\s+/g,'');
        if(!/^Number\.isInteger\(metrics\.status\).*\?\{status:metrics\.status\}:\{\}$/.test(text)
          &&!/^Number\.isFinite\(metrics\.durationMs\).*\?\{durationMs:Math\.round\(metrics\.durationMs!\)\}:\{\}$/.test(text))return false;
        continue;
      }
      if(!ts.isPropertyAssignment(property)&&!ts.isShorthandPropertyAssignment(property))return false;
      fields.set(property.name.getText(file), (ts.isPropertyAssignment(property)?property.initializer:property.name).getText(file).replace(/\s+/g,''));
    }
    if(fields.size!==6||fields.get('timestamp')!=="newDate().toISOString()"||fields.get('level')!=="level==='log'?'info':level")return false;
    const code=fields.get('code')??'';
    if(!/^\/\^\[.*\]\[.*\]\{0,95\}\$\/\.test\(code\)\?code:'invalid_log_event'$/.test(code))return false;
    const server=fields.get('requestId')==='context?.requestId??null'&&fields.get('invocationId')==='context?.invocationId??null'&&fields.get('source')==="context?.source??'background'";
    const clientId=binding('requestId',at)?.getText(file).replace(/\s+/g,'')??'';
    const client=fields.get('requestId')==='requestId'&&fields.get('invocationId')==='null'&&fields.get('source')==='source'
      &&clientId.includes("typeofid==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)?id:null");
    return server||client;
  }
  // An incident ID is safe only when this lexical scope proves it was minted
  // by the global Web Crypto API. Caller IDs, mutable aliases and shadowed
  // bindings remain forbidden; this is not a file/path exception list.
  function serverIncidentId(node:ts.Expression,at:ts.Node):boolean {
    function binds(name:ts.BindingName,target:string):boolean {
      return ts.isIdentifier(name) ? name.text===target
        : name.elements.some(element=>ts.isBindingElement(element)&&binds(element.name,target));
    }
    let cryptoShadowed=false;
    function findShadow(current:ts.Node) {
      if ((ts.isVariableDeclaration(current)||ts.isParameter(current)||ts.isBindingElement(current)
        ||ts.isImportSpecifier(current)||ts.isImportClause(current)||ts.isNamespaceImport(current)
        ||ts.isFunctionDeclaration(current)||ts.isFunctionExpression(current)||ts.isClassDeclaration(current)
        ||ts.isClassExpression(current)||ts.isEnumDeclaration(current)||ts.isModuleDeclaration(current)||ts.isImportEqualsDeclaration(current))
        &&current.name&&ts.isIdentifier(current.name)&&current.name.text==='crypto') cryptoShadowed=true;
      ts.forEachChild(current,findShadow);
    }
    findShadow(file);
    if(cryptoShadowed||!ts.isIdentifier(node))return false;
    const name=node.text;
    for(let ancestor:ts.Node|undefined=at;ancestor;ancestor=ancestor.parent) {
      if(ts.isCatchClause(ancestor)&&ancestor.variableDeclaration&&binds(ancestor.variableDeclaration.name,name))return false;
      if((ts.isClassDeclaration(ancestor)||ts.isClassExpression(ancestor))&&ancestor.name?.text===name)return false;
      if(ts.isFunctionLike(ancestor)&&(ancestor.parameters.some(parameter=>binds(parameter.name,name))
        ||ancestor.name&&ts.isIdentifier(ancestor.name)&&ancestor.name.text===name))return false;
      if(!ts.isBlock(ancestor)&&!ts.isSourceFile(ancestor))continue;
      for(const statement of ancestor.statements) {
        if((ts.isFunctionDeclaration(statement)||ts.isClassDeclaration(statement)||ts.isEnumDeclaration(statement))
          &&statement.name?.text===name)return false;
        if(!ts.isVariableStatement(statement))continue;
        for(const declaration of statement.declarationList.declarations) {
          if(!binds(declaration.name,name))continue;
          if(!ts.isIdentifier(declaration.name))return false;
          const value=declaration.initializer;
          return Boolean(statement.declarationList.flags&ts.NodeFlags.Const)
            &&!!value&&ts.isCallExpression(value)&&value.expression.getText(file)==='crypto.randomUUID'
            &&value.arguments.length===0;
        }
      }
    }
    return false;
  }
  function safePayload(node:ts.Expression,at:ts.Node):boolean {
    if(ts.isStringLiteral(node))return true;
    if(!ts.isCallExpression(node)||node.expression.getText(file)!=='JSON.stringify'||node.arguments.length!==1)return false;
    if(safeEnvelope(node.arguments[0],at))return true;
    if(!ts.isObjectLiteralExpression(node.arguments[0]))return false;
    let hasCode=false;
    return node.arguments[0].properties.every(property=>{
      if(!ts.isPropertyAssignment(property)&&!ts.isShorthandPropertyAssignment(property))return false;
      const key=property.name.getText(file).replace(/^['"]|['"]$/g,'');
      const value=ts.isPropertyAssignment(property)?property.initializer:property.name;
      if(key==='code'){hasCode=true;return constantCode(value,at);}
      if(key==='incidentId')return serverIncidentId(value,at);
      return key==='route'&&safeRoute(value,at);
    })&&hasCode;
  }
  function visit(node:ts.Node) {
    if(ts.isCallExpression(node)&&(ts.isPropertyAccessExpression(node.expression)||ts.isElementAccessExpression(node.expression))
      &&node.expression.expression.getText(file)==='console') {
      if(node.arguments.length!==1||!safePayload(node.arguments[0],node))failures.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line+1);
    }
    ts.forEachChild(node,visit);
  }
  visit(file);return failures;
}

it('S14 catches raw exceptions, identifier-bearing paths, URL objects and dynamic log codes',()=>{
  for(const source of ["console.error('operation_failed', error)","console.warn(JSON.stringify({code:'failed',route:c.req.path}))","console.log(JSON.stringify({code:body.token}))","console.info(JSON.stringify({code:'failed',...body}))"])
    expect(unsafeConsoleCalls(source)).toHaveLength(1);
  expect(unsafeConsoleCalls("console.error(JSON.stringify({code:'provider_failed',route:'POST /api/items/:id'}))")).toEqual([]);
});

it('accepts locally minted incident UUIDs and rejects caller IDs and shadowed or mutable bindings',()=>{
  expect(unsafeConsoleCalls("const incidentId=crypto.randomUUID();console.error(JSON.stringify({code:'failed',incidentId}));")).toEqual([]);
  expect(unsafeConsoleCalls("const incidentId=crypto.randomUUID();Promise.resolve().catch(()=>console.error(JSON.stringify({code:'failed',incidentId}))); ")).toEqual([]);
  for(const source of [
    "console.error(JSON.stringify({code:'failed',incidentId:body.id}));",
    "const incidentId='9cda509d-a57a-4bbe-9090-cf8ccf0c6c9b';console.error(JSON.stringify({code:'failed',incidentId}));",
    "let incidentId=crypto.randomUUID();console.error(JSON.stringify({code:'failed',incidentId}));",
    "const incidentId=crypto.randomUUID();function send(incidentId){console.error(JSON.stringify({code:'failed',incidentId}));}",
    "const incidentId=crypto.randomUUID();{const incidentId=body.id;console.error(JSON.stringify({code:'failed',incidentId}));}",
    "const incidentId=crypto.randomUUID();{const {incidentId}=body;console.error(JSON.stringify({code:'failed',incidentId}));}",
    "const incidentId=crypto.randomUUID();try{}catch(incidentId){console.error(JSON.stringify({code:'failed',incidentId}));}",
    "const crypto=body;const incidentId=crypto.randomUUID();console.error(JSON.stringify({code:'failed',incidentId}));",
    "namespace crypto {export function randomUUID(){return body.id;}}const incidentId=crypto.randomUUID();console.error(JSON.stringify({code:'failed',incidentId}));",
    "(function crypto(){const incidentId=crypto.randomUUID();console.error(JSON.stringify({code:'failed',incidentId}));})();",
  ])expect(unsafeConsoleCalls(source)).toHaveLength(1);
});

it('S14 production console calls carry fixed codes, route templates and proven server UUIDs only',()=>{
  const root=resolve(import.meta.dirname,'../../..');
  const findings:string[]=[];
  function walk(directory:string) {
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      const path=join(directory,entry.name);
      if(entry.isDirectory()){if(entry.name!=='test-utils')walk(path);continue;}
      if(!/\.(ts|tsx)$/.test(path)||/\.(test|spec)\./.test(path))continue;
      const source=readFileSync(path,'utf8');if(!source.includes('console'))continue;
      findings.push(...unsafeConsoleCalls(source).map(line=>`${path.slice(root.length+1)}:${line}`));
    }
  }
  for(const directory of ['apps/worker/src','apps/web/src','apps/liff/src','packages/db/src','packages/line-sdk/src','packages/shared/src','packages/sdk/src','packages/mcp-server/src'])walk(join(root,directory));
  expect(findings).toEqual([]);
});
