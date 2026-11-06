/** 更新: node scripts/observability/generate-error-codes.mjs。実行時の許可や上限は作らない。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../..');
const codes = new Map();
const codePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
function add(code, file, node, source) {
  if (!codePattern.test(code)) return;
  const locations = codes.get(code) ?? new Set();
  locations.add(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
  codes.set(code, locations);
}
const files = execFileSync('rg', ['--files', 'apps/worker/src', 'packages/db/src'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(file => /\.tsx?$/.test(file) && !file.includes('.test.') && !file.includes('/client/') && !file.includes('/openapi/'));
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const literals = node => {
    if (ts.isStringLiteral(node)) add(node.text, file, node, source);
    ts.forEachChild(node, literals);
  };
  function walk(node) {
    if (ts.isPropertyAssignment(node) && ['code', 'error'].includes(node.name.getText(source)) && ts.isStringLiteral(node.initializer)) {
      add(node.initializer.text, file, node, source);
    }
    if ((ts.isPropertySignature(node) || ts.isParameter(node)) && node.name.getText(source) === 'code' && node.type) literals(node.type);
    if (ts.isTypeAliasDeclaration(node) && /ErrorCode$/.test(node.name.text)) literals(node.type);
    if (ts.isVariableDeclaration(node) && /^(code|errorCode|error_code|failureCode)$/i.test(node.name.getText(source)) && node.initializer) {
      const branches = item => {
        if (ts.isStringLiteral(item)) add(item.text, file, item, source);
        else if (ts.isConditionalExpression(item)) { branches(item.whenTrue); branches(item.whenFalse); }
      };
      branches(node.initializer);
    }
    if (ts.isNewExpression(node) && /Error$/.test(node.expression.getText(source))) {
      const argument = node.arguments?.[0];
      if (argument && ts.isStringLiteral(argument)) add(argument.text, file, argument, source);
    }
    if (file.endsWith('/input-errors.ts') && ts.isVariableDeclaration(node) && node.name.getText(source) === 'messages' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) if (property.name) add(property.name.getText(source), file, property, source);
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
}
const middleware = 'apps/worker/src/middleware/api-contract.ts';
const source = ts.createSourceFile(middleware, fs.readFileSync(path.join(root, middleware), 'utf8'), ts.ScriptTarget.Latest, true);
const defaults = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'HTTP_ERROR_CODES' && ts.isObjectLiteralExpression(node.initializer)) {
    for (const entry of node.initializer.properties) {
      const values = Object.fromEntries(entry.initializer.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(source), p.initializer.text]));
      defaults.push(`| ${entry.name.getText(source)} | \`${values.code}\` | ${values.message} |`);
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
const rows = [...codes].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([code, locations]) => {
  const all = [...locations].sort();
  const file = all[0].replace(/:\d+$/, '');
  return `| \`${code}\` | [宣言](${path.posix.join('..', file)})（${all.length}か所） |`;
});
const text = `# APIのエラーと追跡番号

共通基盤 §11・§12と整理段2 S03（B-385③）の契約です。JSON APIのHTTP失敗（4xx/5xx）は最外周で以下の形へそろえます。外部から見えるpath・method・成功応答の本文は変更しません。

\`\`\`json
{"success":false,"error":{"code":"VERSION_CONFLICT","message":"最新の内容を確認してください。","requestId":"ab9daa00-9761-40a9-a9ee-a2c21bbe62c0","fieldErrors":[{"field":"name","message":"名前を入力してください。"}]},"data":{"currentVersion":4}}
\`\`\`

- \`error.code\` は機械の分岐、\`error.message\` は人向けの案内、\`fieldErrors\` はJSONの項目名と理由です。項目を特定できなければ空配列です。
- 既存の機械コードの大文字・小文字、HTTP状態、追加の業務データ（\`data\`・\`currentVersion\`・\`canRetry\`・復旧キー等）、\`Retry-After\` は保持します。コードのない応答だけ下表を使います。400と422の使い分けをこの整理だけで変えません。
- 全応答の \`X-Request-ID\` と \`error.requestId\` は同じサーバー生成UUIDです。入力の追跡ヘッダー・cf-ray・顧客IDは採番の代わりにしません。CORSの応答公開ヘッダーにも含めます。リクエストの許可ヘッダーは増やしません。
- 管理画面の \`ApiError\` はstatus/code/trackingId/fields、LIFFはstatus/code/requestId/fieldsを保持します。LIFFの旧body.error/body.code分岐は受信時の互換表示で保ちます。SDKの \`LineHarnessError\` も同じ情報を持ちます。旧形式を読む互換性は残します。
- 2xxの業務状態（生成結果のfailedや未完202）とJSON-RPCのプロトコルエラーはHTTP失敗へ読み替えません。MCPの負のcode/id、既存の成功・受付の意味を保ちます。OAuth等のHTML文書は文書の表示を保ち、追跡ヘッダーを付けます。
- SQL、スタック、HTML、認証値や外部の自由な例外は人向けの案内にしません。ログは固定イベント名・数値・サーバー生成の追跡番号だけです。本文、URL、個人情報、認証情報をログへ渡しません。

## コードがないHTTP失敗の既定

| HTTP | code | 案内 |
| --- | --- | --- |
${defaults.join('\n')}

その他の4xx/5xxも元のHTTP状態を保持し、4xxはBAD_REQUEST、5xxはINTERNAL_SERVER_ERRORを使います。送達不明を成功にしたり、一般の409を受理済みと扱ったり、無条件の自動再送を追加したりしません。

## 追跡の流れ

HTTP/cron/queueの各メッセージ/emailの入口で実行のIDを作り、非同期の継続へ渡します。ログの \`invocationId\` は各実行、\`requestId\` は元の依頼です。外部のfetchとLINE SDKの3つの低層通信へX-Request-IDを渡し、timeout/redirect/認証/本文/冪等キー/要求回数は保ちます。既存の監査記録のrequest_trace_idには同じ番号を保存し、既存の伏せ方を維持します。

既存キューの内部メッセージにもrequestIdを添え、再開・予約し直し・失敗のログまで元の番号を保ちます。業務本文・受理条件・待機・試行回数は変えず、古いメッセージは再開時の新しい番号を使います。新しいQueueやbindingは追加しません。

A06の保存済みcall stateにはrequestIdを含め、cronで再開しても同じ依頼を追えます。古いcall stateの番号を推測して補いません。その他の既存の待ち行列に元の依頼を保存する場所がない場合は、実行単位の相関までです。全ての永続ジョブの元の依頼まで保存できたとは扱わず、保存先と移行の承認を司令塔へ返します。新しいmigrationは作成しません。

## 既存コードの宣言一覧

以下は現行のhandler・業務エラー型・入力検証から収集したコード宣言です。内部の業務分類として宣言されるものも含め、動的な外部本文をコードの一覧として登録しません。HTTPは各handlerの現行の状態を保ちます。宣言数は行数の凍結や許可一覧ではありません。

更新は \`node scripts/observability/generate-error-codes.mjs\`。コードや検証条件の削除を正当化する見張りには使いません。

| code | 定義元 |
| --- | --- |
${rows.join('\n')}
`;
fs.writeFileSync(path.join(root, 'docs/error-codes.md'), text);
console.log(JSON.stringify({ codes: codes.size, httpDefaults: defaults.length }));
