import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { FEATURE_IDS } from '@line-crm/shared';
import { FEATURE_JOB_MANIFEST } from './services/feature-enforcement.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('feature job manifest', () => {
  test('named scheduled job を全件分類する', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const scheduledSection = source.slice(
      source.indexOf('async function runFrequentHeavyJobs'),
      source.indexOf('// Scheduled handler for cron triggers'),
    );
    const names = [...scheduledSection.matchAll(/\bname:\s*'([^']+)'/g)].map((match) => match[1]!);
    const classified = new Set(FEATURE_JOB_MANIFEST.map(({ name }) => name));
    expect(names.filter((name) => !classified.has(name))).toEqual([]);
  });

  test('delivery dispatcher と manifest の featureId が固定される', () => {
    const requiredDeliveryJobs = [
      'automation deliveries',
      'booking reminders',
      'event reminders',
      'meet consultation reminders',
      'webinar reminders',
      'webinar notifications',
      'webinar followups',
      'NEN campaign deliveries',
      'common variable schedules',
      'scenario deliveries',
      'broadcast deliveries',
      'reminder deliveries',
    ];
    const names = FEATURE_JOB_MANIFEST.map(({ name }) => name);
    expect(requiredDeliveryJobs.filter((name) => !names.includes(name))).toEqual([]);
  });

  test('job 名は一意で featureId は共有カタログ内に限る', () => {
    const names = FEATURE_JOB_MANIFEST.map(({ name }) => name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    const known = new Set<string>(FEATURE_IDS);
    const unknown = FEATURE_JOB_MANIFEST.filter(
      ({ classification }) => classification.kind === 'feature' && !known.has(classification.featureId),
    );
    expect(duplicates).toEqual([]);
    expect(unknown).toEqual([]);
  });

  /*
   * #643 機械検査: manifest の job と実装のoff強制を突き合わせる。
   *
   * 名前を足しただけで「止まるつもり」になるのを防ぐ。gated の job は
   * 判定を書いたファイルが実在し、目印が実ソースに残っていることを
   * 1件ずつ確かめる。判定を消す・別ファイルへ移すとここで落ちる。
   */
  test('機能に属する job は全件 gated で、目印が実ソースに残っている', () => {
    const featureJobs = FEATURE_JOB_MANIFEST.filter(
      ({ classification }) => classification.kind === 'feature',
    );
    // 機能に属する job は例外なく実装側で止める。exempt は core だけ。
    expect(featureJobs.filter(({ enforcement }) => enforcement.mode !== 'gated').map(({ name }) => name))
      .toEqual([]);

    const missingSources: string[] = [];
    const missingMarkers: string[] = [];
    for (const job of FEATURE_JOB_MANIFEST) {
      if (job.enforcement.mode !== 'gated') continue;
      expect(job.enforcement.sources.length).toBeGreaterThan(0);
      expect(job.enforcement.markers.length).toBeGreaterThan(0);
      let merged = '';
      for (const source of job.enforcement.sources) {
        const path = `${REPO_ROOT}${source}`;
        if (!existsSync(path)) {
          missingSources.push(`${job.name}: ${source}`);
          continue;
        }
        merged += readFileSync(path, 'utf8');
      }
      for (const marker of job.enforcement.markers) {
        if (!merged.includes(marker)) missingMarkers.push(`${job.name}: ${marker}`);
      }
    }
    expect(missingSources).toEqual([]);
    expect(missingMarkers).toEqual([]);
  });

  test('core の job だけが exempt で、理由を必ず持つ', () => {
    const exempt = FEATURE_JOB_MANIFEST.filter(({ enforcement }) => enforcement.mode === 'exempt');
    expect(exempt.filter(({ classification }) => classification.kind !== 'core').map(({ name }) => name))
      .toEqual([]);
    expect(
      exempt.filter(({ enforcement }) => enforcement.mode === 'exempt' && !enforcement.reason.trim())
        .map(({ name }) => name),
    ).toEqual([]);
  });
});
