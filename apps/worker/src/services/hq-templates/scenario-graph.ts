export type ScenarioGraphReferenceKind = 'tag' | 'scenario' | 'template';
export type ScenarioGraphReference = { kind: ScenarioGraphReferenceKind; sourceId: string };
export type ScenarioGraphRow = Record<string, string | number | null>;
export type ScenarioGraphStatement = { sql: string; bindings: readonly (string | number | null)[] };

export class ScenarioGraphError extends Error {
  constructor(public readonly code: 'REFERENCE_UNAVAILABLE' | 'UNSUPPORTED_REFERENCE') { super(code); }
}

const unavailable = (): never => { throw new ScenarioGraphError('REFERENCE_UNAVAILABLE'); };
const unsupported = (): never => { throw new ScenarioGraphError('UNSUPPORTED_REFERENCE'); };
const referenceKey = (kind: ScenarioGraphReferenceKind, sourceId: string) => `${kind}:${sourceId}`;

export function hasPortableScenarioReference(value: unknown): boolean {
  let current = String(value ?? '');
  for (let attempt = 0; attempt < 4; attempt++) {
    if (/(?:liff\.line\.me|[?&#](?:form|template|scenario|tag|account|line[_-]?account)(?:s|[_-]?ids?)?=|\/(?:forms?|scenarios?|templates?|tags?|accounts?)\/)/i.test(current)) return true;
    if (!/%[0-9a-f]{2}/i.test(current)) return false;
    try {
      const next = decodeURIComponent(current);
      if (next === current) return false;
      current = next;
    } catch { return true; }
  }
  return /%[0-9a-f]{2}/i.test(current);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') unsupported();
  let parsed: unknown;
  try { parsed = JSON.parse(value as string); } catch { unsupported(); }
  return parsed;
}

function parseObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) unsupported();
  return parsed as Record<string, unknown>;
}

/** Collect only reference keys whose runtime contract is known. Unknown account-local IDs fail closed. */
export function collectJsonReferences(value: unknown): ScenarioGraphReference[] {
  const refs = new Map<string, ScenarioGraphReference>();
  const add = (kind: ScenarioGraphReferenceKind, id: unknown) => {
    if (typeof id !== 'string' || !id || id.length > 160) unsupported();
    const sourceId = id as string;
    refs.set(referenceKey(kind, sourceId), { kind, sourceId });
  };
  const visit = (item: unknown, key?: string): void => {
    if (key === 'tagId') return add('tag', item);
    if (key === 'scenarioId') return add('scenario', item);
    if (key === 'templateId') return add('template', item);
    if (key === 'tagIds') {
      if (!Array.isArray(item)) unsupported();
      for (const id of item as unknown[]) add('tag', id);
      return;
    }
    if (key && /^(?:folderId|friendFieldId|friendFieldIds|fieldId|markId|reminderId|eventId|mediaId|formId|trackedLinkId|richMenuId|accountId|lineAccountId)$/.test(key)) {
      if (item != null && item !== '' && !(Array.isArray(item) && item.length === 0)) unsupported();
      return;
    }
    if (typeof item === 'string') {
      if (hasPortableScenarioReference(item)) unsupported();
      return;
    }
    if (Array.isArray(item)) { for (const child of item) visit(child); return; }
    if (item && typeof item === 'object') for (const [childKey, child] of Object.entries(item)) visit(child, childKey);
  };
  visit(value);
  return [...refs.values()];
}

export function remapScenarioJson(value: string | number | null, ids: ReadonlyMap<string, string>): string | number | null {
  if (typeof value !== 'string') return value;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return value; }
  const visit = (item: unknown, key?: string): unknown => {
    if (typeof item === 'string' && ['tagId', 'scenarioId', 'templateId'].includes(key ?? '')) return ids.get(item) ?? unavailable();
    if (key === 'tagIds') {
      if (!Array.isArray(item)) unsupported();
      return (item as unknown[]).map(id => typeof id === 'string' ? ids.get(id) ?? unavailable() : unsupported());
    }
    if (Array.isArray(item)) return item.map(child => visit(child));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([childKey, child]) => [childKey, visit(child, childKey)]));
    return item;
  };
  return JSON.stringify(visit(parsed));
}

export type ScenarioGraphScenario = {
  row: ScenarioGraphRow;
  steps: ScenarioGraphRow[];
  actions: ScenarioGraphRow[];
  triggers: ScenarioGraphRow[];
  references: ScenarioGraphReference[];
};
export type ScenarioReferenceGraph = {
  sourceAccountId: string;
  scenarios: Map<string, ScenarioGraphScenario>;
  tags: Map<string, ScenarioGraphRow>;
  templates: Map<string, ScenarioGraphRow>;
  references: ScenarioGraphReference[];
  /** Stable source snapshot; callers may bind it to an immutable preflight token. */
  snapshot: string;
};

const graphGuard = (condition: string, bindings: ScenarioGraphStatement['bindings']): ScenarioGraphStatement => ({ sql: `SELECT json(CASE WHEN (${condition}) THEN '{}' ELSE 'HQ_SCENARIO_GRAPH_CONFLICT' END)`, bindings });
const exactGraphRowGuard = (table: string, row: ScenarioGraphRow): ScenarioGraphStatement => {
  const columns = Object.keys(row);
  return graphGuard(`EXISTS(SELECT 1 FROM ${table} WHERE ${columns.map(column => `${column} IS ?`).join(' AND ')})`, columns.map(column => row[column]));
};

/** Reusable D1 guards for form- and rich-menu-origin planners. */
export function scenarioGraphSourceGuardStatements(graph: ScenarioReferenceGraph): ScenarioGraphStatement[] {
  const statements: ScenarioGraphStatement[] = [];
  for (const row of graph.tags.values()) statements.push(exactGraphRowGuard('tags', row));
  for (const row of graph.templates.values()) statements.push(exactGraphRowGuard('templates', row));
  for (const scenario of graph.scenarios.values()) {
    statements.push(exactGraphRowGuard('scenarios', scenario.row), graphGuard(`(SELECT COUNT(*) FROM scenario_steps WHERE scenario_id=?)=?`, [scenario.row.id, scenario.steps.length]), graphGuard(`(SELECT COUNT(*) FROM scenario_actions WHERE scenario_id=?)=?`, [scenario.row.id, scenario.actions.length]), graphGuard(`(SELECT COUNT(*) FROM scenario_triggers WHERE scenario_id=?)=?`, [scenario.row.id, scenario.triggers.length]));
    statements.push(...scenario.steps.map(row => exactGraphRowGuard('scenario_steps', row)), ...scenario.actions.map(row => exactGraphRowGuard('scenario_actions', row)), ...scenario.triggers.map(row => exactGraphRowGuard('scenario_triggers', row)));
  }
  return statements;
}

export async function loadScenarioReferenceGraph(db: D1Database, tenantId: string, rootScenarioIds: readonly string[]): Promise<ScenarioReferenceGraph> {
  const scenarios = new Map<string, ScenarioGraphScenario>(), tags = new Map<string, ScenarioGraphRow>(), templates = new Map<string, ScenarioGraphRow>();
  const visiting = new Set<string>(), visited = new Set<string>(), allReferences = new Map<string, ScenarioGraphReference>();
  let sourceAccountId: string | null = null;
  const addRef = (reference: ScenarioGraphReference) => allReferences.set(referenceKey(reference.kind, reference.sourceId), reference);
  const ensureSameAccount = (row: ScenarioGraphRow) => {
    const accountId = String(row.line_account_id ?? '');
    if (!accountId || (sourceAccountId && sourceAccountId !== accountId)) unavailable();
    sourceAccountId ??= accountId;
  };
  const loadTag = async (id: string) => {
    if (tags.has(id)) return;
    const row = await db.prepare(`SELECT t.* FROM tags t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND t.status='active' AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(id, tenantId).first<ScenarioGraphRow>();
    if (!row) unavailable();
    ensureSameAccount(row!); tags.set(id, row!); addRef({ kind: 'tag', sourceId: id });
  };
  const loadTemplate = async (id: string) => {
    if (templates.has(id)) return;
    const row = await db.prepare(`SELECT t.* FROM templates t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(id, tenantId).first<ScenarioGraphRow>();
    if (!row) unavailable();
    ensureSameAccount(row!);
    if (row!.folder_id || row!.created_from_recipe_id || row!.recipe_clone_run_id) unsupported();
    const refs: ScenarioGraphReference[] = [];
    for (const field of ['message_content', 'carousel_actions_json', 'question_json', 'draft_message_content', 'draft_carousel_actions_json', 'draft_question_json']) {
      const raw = row![field];
      if (raw == null || raw === '') continue;
      if (field.includes('json')) refs.push(...collectJsonReferences(parseJson(raw)));
      else {
        if (hasPortableScenarioReference(raw)) unsupported();
        if (/^\s*[\[{]/.test(String(raw))) refs.push(...collectJsonReferences(parseJson(raw)));
      }
    }
    templates.set(id, row!); addRef({ kind: 'template', sourceId: id });
    for (const ref of refs) {
      addRef(ref);
      if (ref.kind === 'tag') await loadTag(ref.sourceId);
      else if (ref.kind === 'scenario') await loadScenario(ref.sourceId);
      else await loadTemplate(ref.sourceId);
    }
  };
  const loadScenario = async (id: string): Promise<void> => {
    if (visited.has(id)) return;
    if (visiting.has(id)) unsupported();
    visiting.add(id);
    const row = await db.prepare(`SELECT s.* FROM scenarios s JOIN line_accounts a ON a.id=s.line_account_id WHERE s.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(id, tenantId).first<ScenarioGraphRow>();
    if (!row) unavailable();
    ensureSameAccount(row!);
    if (row!.folder_id || row!.audience_condition_json) unsupported();
    const steps = (await db.prepare(`SELECT * FROM scenario_steps WHERE scenario_id=? ORDER BY step_order,id`).bind(id).all<ScenarioGraphRow>()).results;
    const actions = (await db.prepare(`SELECT * FROM scenario_actions WHERE scenario_id=? ORDER BY sort_order,id`).bind(id).all<ScenarioGraphRow>()).results;
    const triggers = (await db.prepare(`SELECT * FROM scenario_triggers WHERE scenario_id=? ORDER BY kind,id`).bind(id).all<ScenarioGraphRow>()).results;
    const refs = new Map<string, ScenarioGraphReference>();
    const localAdd = (kind: ScenarioGraphReferenceKind, sourceId: unknown) => {
      if (typeof sourceId !== 'string' || !sourceId) unsupported();
      const id = sourceId as string;
      const ref: ScenarioGraphReference = { kind, sourceId: id }; refs.set(referenceKey(kind, id), ref); addRef(ref);
    };
    if (row!.trigger_tag_id) localAdd('tag', row!.trigger_tag_id);
    if (row!.on_complete_scenario_id) localAdd('scenario', row!.on_complete_scenario_id);
    for (const step of steps) {
      if (step.template_id) localAdd('template', step.template_id);
      if (step.on_reach_tag_id) localAdd('tag', step.on_reach_tag_id);
      if (step.condition_type || step.condition_value) unsupported();
      if (hasPortableScenarioReference(step.message_content)) unsupported();
      if (/^\s*[\[{]/.test(String(step.message_content))) for (const ref of collectJsonReferences(parseJson(step.message_content))) localAdd(ref.kind, ref.sourceId);
      for (const field of ['message_bubbles_json', 'target_condition_json', 'question_json']) {
        const raw = step[field];
        if (raw == null || raw === '') continue;
        for (const ref of collectJsonReferences(parseJson(raw))) localAdd(ref.kind, ref.sourceId);
      }
    }
    for (const action of actions) {
      if (action.condition_json) unsupported();
      const config = parseObject(action.config_json);
      if (action.action_type === 'tag') {
        if (Object.keys(config).some(key => !['op', 'tagIds', 'folderId'].includes(key))) unsupported();
        if (!['add', 'remove'].includes(String(config.op)) || !Array.isArray(config.tagIds) || config.tagIds.length === 0 || config.folderId) unsupported();
        for (const ref of collectJsonReferences(config)) localAdd(ref.kind, ref.sourceId);
      } else if (action.action_type === 'scenario') {
        if (Object.keys(config).some(key => !['op', 'scenarioId', 'restart', 'rememberPrevious'].includes(key))) unsupported();
        if (!['start', 'stop', 'resume_previous'].includes(String(config.op)) || (config.op === 'start' && (typeof config.scenarioId !== 'string' || !config.scenarioId))) unsupported();
        for (const ref of collectJsonReferences(config)) localAdd(ref.kind, ref.sourceId);
      } else if (action.action_type === 'send_template') {
        if (Object.keys(config).some(key => key !== 'templateId')) unsupported();
        if (typeof config.templateId !== 'string' || !config.templateId) unsupported();
        for (const ref of collectJsonReferences(config)) localAdd(ref.kind, ref.sourceId);
      } else if (action.action_type === 'send_message') {
        if (Object.keys(config).some(key => key !== 'content')) unsupported();
        if (typeof config.content !== 'string' || !config.content.trim() || hasPortableScenarioReference(config.content)) unsupported();
      } else unsupported();
    }
    for (const trigger of triggers) {
      if (trigger.kind === 'tag_added') localAdd('tag', trigger.tag_id);
      else if (!['friend_add', 'form_answer', 'booking_confirmed'].includes(String(trigger.kind))) unsupported();
    }
    scenarios.set(id, { row: row!, steps, actions, triggers, references: [...refs.values()] });
    for (const ref of refs.values()) {
      if (ref.kind === 'tag') await loadTag(ref.sourceId);
      else if (ref.kind === 'template') await loadTemplate(ref.sourceId);
      else await loadScenario(ref.sourceId);
    }
    visiting.delete(id); visited.add(id); addRef({ kind: 'scenario', sourceId: id });
  };
  for (const id of rootScenarioIds) await loadScenario(id);
  const references = [...allReferences.values()].sort((a,b) => referenceKey(a.kind,a.sourceId).localeCompare(referenceKey(b.kind,b.sourceId)));
  if (new Set(references.map(reference => reference.sourceId)).size !== references.length) unsupported();
  const snapshot = JSON.stringify({ sourceAccountId, scenarios: [...scenarios], tags: [...tags], templates: [...templates], references });
  return { sourceAccountId: sourceAccountId ?? unavailable(), scenarios, tags, templates, references, snapshot };
}
