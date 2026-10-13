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
  function safePayload(node:ts.Expression,at:ts.Node):boolean {
    if(ts.isStringLiteral(node))return true;
    if(!ts.isCallExpression(node)||node.expression.getText(file)!=='JSON.stringify'||node.arguments.length!==1||!ts.isObjectLiteralExpression(node.arguments[0]))return false;
    let hasCode=false;
    return node.arguments[0].properties.every(property=>{
      if(!ts.isPropertyAssignment(property)&&!ts.isShorthandPropertyAssignment(property))return false;
      const key=property.name.getText(file).replace(/^['"]|['"]$/g,'');
      const value=ts.isPropertyAssignment(property)?property.initializer:property.name;
      if(key==='code'){hasCode=true;return constantCode(value,at);}
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

it('S14 production console calls carry fixed codes and route templates only',()=>{
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
