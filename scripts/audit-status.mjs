#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BOARD = 'kentavndng/line-harness-board';
const AUDIT_ISSUES = Array.from({ length: 32 }, (_, index) => 489 + index);
const SEVERITIES = ['重大', '中', '軽', '共通依頼'];

function loadIssues() {
  const raw = execFileSync(
    'gh',
    [
      'issue',
      'list',
      '-R',
      BOARD,
      '--state',
      'all',
      '--limit',
      '200',
      '--json',
      'number,title,state,body,comments',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return new Map(JSON.parse(raw).map((issue) => [issue.number, issue]));
}

function clean(text) {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/^[:：｜|\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortSummary(item) {
  const problem = [item.heading, ...item.lines]
    .map(clean)
    .find((line) => /何が(?:問題か)?(?:\([^)]*\))?[:：]/.test(line));
  let value = problem
    ? problem.replace(/^.*?何が(?:問題か)?(?:\([^)]*\))?[:：]\s*/, '')
    : clean(item.heading);
  if (!value || /^(ファイル|apps\/|packages\/|scripts\/)/.test(value)) {
    const colon = value.match(/[：｜|]\s*(.+)/);
    if (colon) value = colon[1];
  }
  value = value.replace(/^[【[][^】\]]+[】\]]\s*/, '');
  return [...value].length > 20 ? `${[...value].slice(0, 19).join('')}…` : value;
}

function parseAudit(issue) {
  const lines = issue.body.split(/\r?\n/);
  const items = [];
  const counters = new Map(SEVERITIES.map((severity) => [severity, 0]));
  const explicitSections = new Set();
  let severity = null;
  let current = null;

  const finish = () => {
    if (!current) return;
    current.summary = shortSummary(current);
    if (current.severity === '共通依頼' && /^なし(?:[（(。]|$)/.test(current.summary)) {
      current = null;
      return;
    }
    items.push(current);
    current = null;
  };

  for (const line of lines) {
    const direct = line.match(/^#{2,4}\s+(重大|中|軽)(\d+)[:：.]?\s*(.*)$/);
    if (direct) {
      finish();
      severity = direct[1];
      explicitSections.add(severity);
      const index = Number(direct[2]);
      counters.set(severity, Math.max(counters.get(severity), index));
      current = { severity, key: direct[2], heading: direct[3], lines: [] };
      continue;
    }

    const section = line.match(/^#{2,4}\s+(重大|中|軽|共通依頼)\s*$/);
    if (section) {
      finish();
      severity = section[1];
      continue;
    }
    const subsection = severity && line.match(/^#{3,4}\s+(\d+)[.\s]+(.*)$/);
    if (subsection) {
      finish();
      explicitSections.add(severity);
      const index = Number(subsection[1]);
      counters.set(severity, Math.max(counters.get(severity), index));
      current = { severity, key: subsection[1], heading: subsection[2], lines: [] };
      continue;
    }
    if (/^#{2,4}\s+/.test(line)) {
      finish();
      severity = null;
      continue;
    }
    if (!severity) continue;

    const explicit =
      line.match(/^\s*\*\*([A-Za-z]?\d+)(?:\.\s*|\s+)(.*?)\*\*\s*$/) ??
      line.match(/^\s*(\d+)\.\s+(.*)$/) ??
      line.match(/^\s*-\s+\[[^\]]+\]\s+([A-Za-z]?\d+)\s+(.*)$/) ??
      line.match(/^\s*-\s+([A-Za-z]\d+)\s+(.*)$/);
    const anonymous =
      !explicitSections.has(severity) &&
      !/^-\s+なし(?:\s|[（(])/.test(line) &&
      (/^-\s+(?:【[^】]+】|\*\*?ファイル|ファイル[:：]|`?(?:apps|packages|scripts)\/)/.test(line) ||
        (severity === '共通依頼' && /^-\s+/.test(line) && !/^-\s+(?:何が|なぜ|直し方)/.test(line)));

    if (explicit || anonymous) {
      finish();
      if (explicit) explicitSections.add(severity);
      const nextIndex = counters.get(severity) + 1;
      const key = explicit?.[1] ?? String(nextIndex);
      const numericKey = Number.parseInt(key.replace(/^\D+/, ''), 10);
      counters.set(severity, Math.max(nextIndex, Number.isFinite(numericKey) ? numericKey : 0));
      current = {
        severity,
        key,
        heading: explicit?.[2] ?? line.replace(/^-\s+/, ''),
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  finish();
  return items;
}

function featureOf(issue) {
  return Number(issue.title.match(/機能(\d+)/)?.[1] ?? 0);
}

const RULES = [];
const addRule = (issue, severity, keys, status) => {
  RULES.push({ issue, severity, keys: keys === '*' ? '*' : new Set(keys.map(String)), status });
};
const range = (start, end, prefix = '') =>
  Array.from({ length: end - start + 1 }, (_, index) => `${prefix}${start + index}`);

// 後続票が段全体を扱うもの。個別の修正済み記録は、この後の規則で上書きする。
for (const issue of [493, 496, 489, 501]) addRule(issue, '軽', '*', '別票 #574');
for (const issue of [495, 490, 494, 497]) addRule(issue, '軽', '*', '別票 #577');
for (const issue of [502, 503, 510, 498]) addRule(issue, '軽', '*', '別票 #578');
for (const issue of [505, 511, 514, 512]) addRule(issue, '軽', '*', '別票 #579');
for (const issue of [500, 517, 509, 519]) addRule(issue, '軽', '*', '別票 #580');
for (const issue of [504, 507, 515]) addRule(issue, '軽', '*', '別票 #581');
for (const issue of [491, 492, 499]) addRule(issue, '中', '*', '別票 #570');
for (const issue of [508, 516, 520]) addRule(issue, '中', '*', '別票 #571');
for (const issue of [506, 513, 518]) addRule(issue, '中', '*', '別票 #567');
addRule(491, '軽', range(1, 8), '別票 #586');
addRule(492, '軽', range(8, 11), '別票 #586');
addRule(499, '軽', range(1, 14, 'L'), '別票 #586');
addRule(508, '軽', range(1, 13), '別票 #587');
addRule(516, '軽', range(1, 6), '別票 #587');
addRule(520, '軽', range(11, 16), '別票 #587');

addRule(489, '重大', ['1', '5', '6'], '済 #1327');
addRule(489, '重大', range(2, 4), '済 #1307');
addRule(489, '中', ['7', '15'], '済 #1357');
addRule(489, '中', [...range(8, 14), ...range(16, 18)], '済 #1345');

addRule(490, '重大', '*', '済 #1326');
addRule(490, '中', range(1, 3), '済 #1374');
addRule(490, '中', ['5', '6'], '済 #1344');
addRule(490, '中', ['4', '7', '8', '9'], '済 #1392');

addRule(491, '重大', ['1'], '済 #1309');
addRule(492, '重大', ['1'], '済 #1309');

addRule(493, '重大', ['1'], '済 #1326');
addRule(493, '中', range(2, 5), '済 #1326');
addRule(493, '中', ['6'], '見送り（対応済みを確認）');
addRule(493, '中', ['7', '9', '10'], '済 #1339');
addRule(493, '中', ['8'], '済 #1364');
addRule(493, '軽', ['12'], '別票 #597');

addRule(494, '重大', ['1'], '済 #1307');
addRule(494, '重大', ['2'], '済 #1327');
addRule(494, '中', ['3', '5', '6', '7', '8', '9', '10'], '済 #1372');
addRule(494, '中', ['4'], '見送り（下書き経由を維持）');

addRule(495, '重大', ['1', '2'], '済 #1327');
addRule(495, '重大', ['3'], '済 #1307');
addRule(495, '中', ['4', '6', '7', '8', '12'], '済 #1344');
addRule(495, '中', ['9', '10'], '済 #1374');
addRule(495, '中', ['5', '11'], '済 #1392');

addRule(496, '重大', ['1'], '済 #1307');
addRule(496, '重大', ['2', '3'], '済 #1320');
addRule(496, '中', ['6', '7', '8', '9', '10', '15'], '済 #1320');
addRule(496, '中', ['4', '5', '11', '12', '13', '14', '16'], '済 #1323');
addRule(496, '軽', range(17, 23), '済 #1323');

addRule(497, '中', '*', '済 #1372');
addRule(498, '重大', ['M1'], '済 #1330');
addRule(498, '中', range(2, 6, 'M'), '済 #1341');

addRule(500, '重大', ['1'], '済 #1366');
addRule(500, '重大', ['2', '3'], '済 #1316');
addRule(500, '中', ['1', '2', '3', '5', '6', '7', '8', '9', '10'], '済 #1345');
addRule(500, '中', ['4'], '別票 #557');
addRule(500, '中', ['11'], '済 #1349');

addRule(501, '重大', ['1'], '済 #1305');
addRule(501, '中', [...range(1, 6), ...range(8, 11)], '済 #1331');
addRule(501, '中', ['7'], '済 #1358');
addRule(501, '軽', ['10'], '別票 #597');

addRule(502, '中', range(2, 9), '済 #1365');
addRule(502, '中', ['1'], '済 #1392');
addRule(503, '重大', ['R1', 'R2'], '済 #1305');
addRule(503, '中', range(1, 10, 'M'), '済 #1335');

addRule(504, '重大', '*', '済 #1314');
addRule(504, '中', range(3, 10), '済 #1314');
addRule(504, '中', range(11, 13), '済 #1340');
addRule(504, '軽', range(14, 19), '済 #1340');

addRule(505, '重大', '*', '済 #1366');
addRule(505, '中', ['2', '3', '5', '6', '7', '8', '9'], '済 #1369');
addRule(505, '中', ['1'], '見送り（先行PRと重複）');
addRule(505, '中', ['4'], '見送り（制限方式の仕様待ち）');

addRule(506, '軽', ['1', ...range(4, 7)], '済 #1396');
addRule(506, '軽', ['2', '3'], '別票 #597');

addRule(507, '重大', ['1'], '済 #1314');
addRule(507, '重大', ['2'], '済 #1324');
addRule(507, '中', ['3', '4', '7'], '済 #1337');
addRule(507, '中', ['5', '6'], '済 #1354');
addRule(507, '軽', range(8, 11), '済 #1354');

addRule(509, '重大', ['1', '2'], '済 #1390');
addRule(509, '中', range(1, 11), '済 #1372');

addRule(510, '重大', ['1', 'M1'], '済 #1314');
addRule(510, '中', ['N1', 'N2', 'N4', 'N5', 'N6', 'N7', 'N9'], '済 #1336');
addRule(510, '中', ['N3', 'N8'], '済 #1362');
addRule(510, '中', ['1', '2', '4', '5', '6', '7', '9'], '済 #1336');
addRule(510, '中', ['3', '8'], '済 #1362');

addRule(511, '重大', ['1'], '済 #1307');
addRule(511, '中', ['2', '3', '4', '6', '7', '8', '11'], '済 #1333');
addRule(511, '中', ['5'], '見送り（指摘不成立）');
addRule(511, '中', ['9', '10'], '済 #1364');

addRule(512, '重大', ['1'], '済 #1366');
addRule(512, '重大', ['2', '3'], '済 #1316');
addRule(512, '中', range(1, 9), '済 #1370');

addRule(513, '軽', [...range(1, 7, 'L'), 'L9', 'L11', 'L12', 'L14'], '済 #1396');
addRule(513, '軽', ['L8', 'L10', 'L13'], '別票 #597');

addRule(514, '重大', ['1'], '済 #1316');
addRule(514, '重大', ['2'], '済 #1321');
addRule(514, '重大', ['3', '4'], '済 #1366');
addRule(514, '中', ['5', '6', '10', '14'], '済 #1377');
addRule(514, '中', ['7', '8', '9', '12', '13'], '済 #1373');
addRule(514, '中', ['11'], '済 #1366');

addRule(515, '重大', ['1', '4'], '済 #1367');
addRule(515, '重大', ['2', '3'], '済 #1316');
addRule(515, '中', ['1', '2', '3', '8'], '済 #1376');
addRule(515, '中', range(4, 7), '別票 #573');
addRule(515, '軽', ['1', '4', '5'], '済 #1389');

addRule(516, '重大', '*', '済 #1330');
addRule(517, '重大', ['1'], '済 #1311');
addRule(517, '中', ['1', '4', '5', '6'], '済 #1376');
addRule(517, '中', ['2', '3'], '見送り（速度影響が軽微）');

addRule(518, '重大', ['1'], '済 #1390');
addRule(518, '軽', range(7, 10), '済 #1396');

addRule(519, '中', ['1', '2', '4', '5', '6', '8', '9'], '済 #1369');
addRule(519, '中', ['3'], '見送り（キュー設計が必要）');
addRule(519, '中', ['7'], '見送り（所有外・仕様待ち）');

addRule(520, '重大', ['1'], '済 #1309');
addRule(520, '重大', ['2'], '済 #1316');

// #525 / PR #1311 の共通側修正と、対応不要・画面固有として残った項目。
addRule(493, '共通依頼', '*', '済 #1311');
addRule(495, '共通依頼', ['1'], '済 #1311');
addRule(495, '共通依頼', ['2', '3'], '見送り（点検対象外・問題なし）');
addRule(489, '共通依頼', ['1'], '済 #1395');
addRule(489, '共通依頼', ['2'], '見送り（追加制限不要）');
addRule(505, '共通依頼', ['1', '2', '4'], '済 #1311');
addRule(505, '共通依頼', ['3'], '済 #1311');
addRule(511, '共通依頼', ['1', 'C1'], '済 #1311');
addRule(511, '共通依頼', ['2', 'C2'], '見送り（問題なし）');
addRule(513, '共通依頼', '*', '済 #1311');
addRule(512, '共通依頼', ['1'], '済 #1311');
addRule(512, '共通依頼', ['2'], '済 #1395');
addRule(512, '共通依頼', ['3'], '見送り（CI確認依頼）');
addRule(500, '共通依頼', ['1'], '済 #1311');
addRule(500, '共通依頼', ['2', '3'], '済 #1395');
addRule(517, '共通依頼', '*', '済 #1311');
addRule(516, '共通依頼', ['1'], '済 #1395');
addRule(516, '共通依頼', ['2'], '見送り（問題なし）');
addRule(515, '共通依頼', '*', '済 #1311');

function statusFor(issue, item) {
  let status = '未着手';
  for (const rule of RULES) {
    if (
      rule.issue === issue &&
      rule.severity === item.severity &&
      (rule.keys === '*' || rule.keys.has(item.key))
    ) {
      status = rule.status;
    }
  }
  return status;
}

function buildDocument(issues) {
  const audits = AUDIT_ISSUES.map((number) => {
    const issue = issues.get(number);
    if (!issue) throw new Error(`Issue #${number} を取得できませんでした。`);
    return { issue, feature: featureOf(issue), items: parseAudit(issue) };
  }).sort((a, b) => a.feature - b.feature);
  const features = audits.map((audit) => audit.feature).sort((a, b) => a - b);
  const expectedFeatures = Array.from({ length: 32 }, (_, index) => index + 1);
  if (features.join(',') !== expectedFeatures.join(',')) {
    throw new Error(`機能1〜32が揃っていません: ${features.join(',')}`);
  }
  for (const audit of audits) {
    if (audit.items.length === 0) throw new Error(`Issue #${audit.issue.number} の項目を抽出できませんでした。`);
    const seen = new Set();
    for (const item of audit.items) {
      const identity = `${item.severity}:${item.key}`;
      if (seen.has(identity)) throw new Error(`Issue #${audit.issue.number} の項目 ${identity} が重複しています。`);
      seen.add(identity);
      if ([...item.summary].length > 20) throw new Error(`Issue #${audit.issue.number} の要約が20字を超えています。`);
    }
  }

  const totals = new Map(
    SEVERITIES.map((severity) => [
      severity,
      { total: 0, done: 0, skipped: 0, pending: 0, direct: 0, ticket: 0, confirm: 0 },
    ]),
  );
  for (const audit of audits) {
    for (const item of audit.items) {
      item.status = statusFor(audit.issue.number, item);
      const row = totals.get(item.severity);
      row.total += 1;
      if (item.status.startsWith('済 ')) row.done += 1;
      else if (item.status.startsWith('見送り')) row.skipped += 1;
      else {
        row.pending += 1;
        if (item.status.startsWith('別票 ')) row.ticket += 1;
        else if (item.status.startsWith('要確認')) row.confirm += 1;
        else row.direct += 1;
      }
    }
  }

  const output = [
    '# 点検項目の対応状況',
    '',
    '> 正本: 点検 Issue #489〜#520、後続 Issue #521〜#583、および各 PR。',
    '> 再生成: `node scripts/audit-status.mjs`（GitHub CLI の認証が必要）。',
    '> 集計の「未着手」には、状態が「別票」「要確認」の項目を含みます。',
    '',
    '## 集計',
    '',
    '| 段 | 総数 | 済 | 見送り | 未着手 |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const severity of SEVERITIES) {
    const row = totals.get(severity);
    output.push(`| ${severity} | ${row.total} | ${row.done} | ${row.skipped} | ${row.pending} |`);
  }
  const grand = [...totals.values()].reduce(
    (sum, row) => ({
      total: sum.total + row.total,
      done: sum.done + row.done,
      skipped: sum.skipped + row.skipped,
      pending: sum.pending + row.pending,
    }),
    { total: 0, done: 0, skipped: 0, pending: 0 },
  );
  output.push(`| **合計** | **${grand.total}** | **${grand.done}** | **${grand.skipped}** | **${grand.pending}** |`);
  output.push(
    '',
    '### 未着手の内訳',
    '',
    '| 段 | 未着手（票なし） | 別票あり | 要確認 |',
    '| --- | ---: | ---: | ---: |',
  );
  for (const severity of SEVERITIES) {
    const row = totals.get(severity);
    output.push(`| ${severity} | ${row.direct} | ${row.ticket} | ${row.confirm} |`);
  }
  output.push(
    '',
    '### 更新方法',
    '',
    '後続PRが項目を直したら、このスクリプトの `RULES` に「済 #PR」を追加して再生成します。',
    '見送る場合は理由、別票へ移す場合はIssue番号を同じ規則へ記録します。',
  );

  for (const audit of audits) {
    output.push('', `## 機能${audit.feature}（点検 #${audit.issue.number}）`, '');
    output.push('| 段 | 項目 | 要約 | 状態 |', '| --- | --- | --- | --- |');
    for (const item of audit.items) {
      output.push(`| ${item.severity} | ${item.key} | ${item.summary.replaceAll('|', '／')} | ${item.status} |`);
    }
  }
  return `${output.join('\n')}\n`;
}

const issues = loadIssues();
const document = buildDocument(issues);
const destination = resolve('docs/audit-status.md');
if (process.argv.includes('--stdout')) process.stdout.write(document);
else if (process.argv.includes('--check')) {
  const current = readFileSync(destination, 'utf8');
  if (current !== document) {
    console.error('docs/audit-status.md が最新の台帳データと一致しません。');
    process.exit(1);
  }
  console.log('docs/audit-status.md is up to date');
} else {
  writeFileSync(destination, document);
  console.log(`generated ${destination}`);
}
