import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FEATURE_IDS } from '@line-crm/shared';
import { FEATURE_JOB_MANIFEST } from './services/feature-enforcement.js';

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
});
