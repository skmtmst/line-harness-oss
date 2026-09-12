import type { HqTemplateBinding, HqTemplateStatement } from '@line-crm/db';
import {
  VERSION_CONFLICT_MESSAGE,
  unsupportedHqTemplateAdapter,
  type HqTemplateAdapter,
  type HqTemplateAdapterContext,
  type HqTemplateMatchedReference,
  type HqTemplateReference,
  type HqTemplateResolution,
  type HqTemplateSnapshotToken,
  type HqTemplateStoreAtomicCommitPlan,
} from './contract.js';

export class TemplateHqTemplateError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 409 | 422 | 500 = 400) {
    super(code);
  }
}

export type MessageTemplateMediaDefinition = Readonly<{
  id: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  r2Key: string;
  publicUrl: string | null;
  versionId: string;
  versionNo: number;
  contentHash: string;
}>;

export type MessageTemplateDefinition = Readonly<{
  schemaVersion: 1;
  template: Readonly<{
    id: string;
    name: string;
    category: string;
    messageType: 'text' | 'image' | 'flex' | 'carousel';
    messageContent: string;
    carouselActionsJson: string | null;
    carouselTapLimitMode: 'none' | 'once';
    carouselTapLimitText: string | null;
    questionJson: string | null;
    questionStatus: 'draft' | 'published';
  }>;
  media: readonly MessageTemplateMediaDefinition[];
}>;

export type MessageTemplateTargetSnapshot = Readonly<{
  tenantId: string;
  targetAccountId: string;
  snapshotToken: HqTemplateSnapshotToken;
  templates: readonly Readonly<{ id: string; name: string; updatedAt: string }>[];
  media: readonly Readonly<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    r2Key: string;
    publicUrl: string | null;
    contentHash: string;
    revision: string;
    versionNo: number;
  }>[];
}>;

/**
 * The factory is bound to this authority before it receives an adapter input.
 * A route must derive it from the authenticated tenant and source account.
 */
export type MessageTemplateSourceAuthority = Readonly<{
  tenantId: string;
  sourceAccountId: string;
}>;

export type MessageTemplateSourceMediaBinding = Readonly<{
  tenantId: string;
  templateVersionId: string;
  sourceAccountId: string;
  mediaId: string;
  mediaVersionId: string;
  versionNo: number;
  r2Key: string;
  r2KeyPrefix: string;
  sizeBytes: number;
  contentHash: string;
  etag: string | null;
}>;

/** Result of a tenant-scoped DB lookup by immutable template version id. */
export type MessageTemplateSourceVersion = Readonly<{
  tenantId: string;
  templateVersionId: string;
  sourceAccountId: string;
  definitionJson: string;
  media: readonly MessageTemplateSourceMediaBinding[];
}>;

export type AuthorizedMessageTemplateSource = Readonly<{
  authority: MessageTemplateSourceAuthority;
  version: MessageTemplateSourceVersion;
  definition: MessageTemplateDefinition;
  media: ReadonlyMap<string, MessageTemplateSourceMediaBinding>;
}>;

export type MessageTemplatePreflightItem = Readonly<{
  sourceId: string;
  itemKind: 'template' | 'media';
  name: string;
  targetId: string | null;
  expectedRevision: string | null;
  duplicate: boolean;
  allowedModes: readonly ('create' | 'overwrite' | 'alias')[];
}>;

export interface MessageTemplateAdapterDependencies {
  /** Must resolve by tenant + source account + immutable version id in one authoritative DB lookup. */
  resolveSourceVersion(input: Readonly<{
    authority: MessageTemplateSourceAuthority;
    templateVersionId: string;
  }>): Promise<MessageTemplateSourceVersion | null>;
  loadTargetSnapshot(context: HqTemplateAdapterContext): Promise<MessageTemplateTargetSnapshot>;
  /**
   * Must perform a conditional R2 read when binding.etag is present. Returning null means that
   * the object no longer matches the version recorded by resolveSourceVersion.
   */
  readSourceObjectIfUnchanged(input: Readonly<{
    authority: MessageTemplateSourceAuthority;
    templateVersionId: string;
    media: MessageTemplateMediaDefinition;
    binding: MessageTemplateSourceMediaBinding;
  }>): Promise<Readonly<{ bytes: Uint8Array; etag: string | null }> | null>;
  createId(
    kind: 'template' | 'media' | 'media_version',
    sourceId: string,
    context: HqTemplateAdapterContext,
  ): string;
  createTargetR2Key(
    media: MessageTemplateMediaDefinition,
    targetMediaId: string,
    context: HqTemplateAdapterContext,
  ): string;
  createTargetPublicUrl(
    targetR2Key: string,
    media: MessageTemplateMediaDefinition,
    context: HqTemplateAdapterContext,
  ): string | null;
  createOwnerToken(targetR2Key: string, context: HqTemplateAdapterContext): string;
  now(): string;
}

type VerifiedReference = HqTemplateMatchedReference & Readonly<{
  duplicate: boolean;
  expectedRevision: string | null;
}>;

type MessageTemplateReferenceMetadata = HqTemplateReference & Readonly<{
  source: AuthorizedMessageTemplateSource;
}>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
  }
  return value.trim();
}

function optionalText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  return requiredText(value, max);
}

function nullableInteger(value: unknown): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
  }
  return Number(value);
}

function jsonText(value: unknown, max: number): string | null {
  const text = optionalText(value, max);
  if (text !== null) {
    try {
      JSON.parse(text);
    } catch {
      throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
    }
  }
  return text;
}

/** The version payload stored in hq_template_versions.definition_json. */
export function parseMessageTemplateDefinition(value: unknown): MessageTemplateDefinition {
  const root = object(value);
  const template = object(root.template);
  if (root.schemaVersion !== 1 || !Array.isArray(root.media) || root.media.length > 50) {
    throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
  }
  const messageType = template.messageType;
  if (!['text', 'image', 'flex', 'carousel'].includes(String(messageType))) {
    throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
  }
  const tapLimitMode = template.carouselTapLimitMode ?? 'none';
  if (tapLimitMode !== 'none' && tapLimitMode !== 'once') {
    throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
  }
  const questionStatus = template.questionStatus ?? 'published';
  if (questionStatus !== 'draft' && questionStatus !== 'published') {
    throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
  }
  const media = root.media.map((entry) => {
    const item = object(entry);
    const kind = item.kind;
    if (!['image', 'video', 'audio', 'file'].includes(String(kind))) {
      throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
    }
    const sizeBytes = nullableInteger(item.sizeBytes);
    const versionNo = nullableInteger(item.versionNo);
    if (sizeBytes === null || versionNo === null || versionNo < 1) {
      throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
    }
    return {
      id: requiredText(item.id, 100),
      kind: kind as MessageTemplateMediaDefinition['kind'],
      filename: requiredText(item.filename, 255),
      mimeType: requiredText(item.mimeType, 255),
      sizeBytes,
      width: nullableInteger(item.width),
      height: nullableInteger(item.height),
      durationMs: nullableInteger(item.durationMs),
      r2Key: requiredText(item.r2Key, 1_024),
      publicUrl: optionalText(item.publicUrl, 2_048),
      versionId: requiredText(item.versionId, 100),
      versionNo,
      contentHash: requiredText(item.contentHash, 255),
    };
  });
  if (new Set(media.map((item) => item.id)).size !== media.length
    || new Set(media.map((item) => item.r2Key)).size !== media.length) {
    throw new TemplateHqTemplateError('INVALID_DEFINITION', 422);
  }
  const parsed: MessageTemplateDefinition = {
    schemaVersion: 1,
    template: {
      id: requiredText(template.id, 100),
      name: requiredText(template.name, 255),
      category: requiredText(template.category ?? 'general', 100),
      messageType: messageType as MessageTemplateDefinition['template']['messageType'],
      messageContent: requiredText(template.messageContent, 1_000_000),
      carouselActionsJson: jsonText(template.carouselActionsJson, 1_000_000),
      carouselTapLimitMode: tapLimitMode,
      carouselTapLimitText: optionalText(template.carouselTapLimitText, 10_000),
      questionJson: jsonText(template.questionJson, 1_000_000),
      questionStatus,
    },
    media,
  };
  referencedMedia(parsed);
  return parsed;
}

function normalizeSha256(value: string): string | null {
  const match = /^(?:sha256[:=])?([a-f0-9]{64})$/i.exec(value.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes.byteLength);
  source.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function belongsToR2Prefix(key: string, prefix: string): boolean {
  const normalized = prefix.replace(/\/+$/, '');
  return normalized !== '' && key.startsWith(`${normalized}/`);
}

function parseSourceDefinition(source: MessageTemplateSourceVersion): MessageTemplateDefinition {
  try {
    return parseMessageTemplateDefinition(JSON.parse(source.definitionJson));
  } catch (error) {
    if (error instanceof TemplateHqTemplateError) throw error;
    throw new TemplateHqTemplateError('SOURCE_VERSION_INVALID', 422);
  }
}

function assertAuthorizedSource(
  source: AuthorizedMessageTemplateSource,
  expectedTenantId: string,
  expectedTemplateVersionId: string,
): void {
  const { authority, version, definition, media: bindings } = source;
  if (authority.tenantId !== expectedTenantId
    || version.tenantId !== authority.tenantId
    || version.sourceAccountId !== authority.sourceAccountId
    || version.templateVersionId !== expectedTemplateVersionId
    || bindings.size !== definition.media.length) {
    throw new TemplateHqTemplateError('SOURCE_AUTHORITY_MISMATCH', 422);
  }
  for (const media of definition.media) {
    const binding = bindings.get(media.id);
    if (!binding
      || binding.tenantId !== authority.tenantId
      || binding.sourceAccountId !== authority.sourceAccountId
      || binding.templateVersionId !== expectedTemplateVersionId
      || binding.mediaVersionId !== media.versionId
      || binding.versionNo !== media.versionNo
      || binding.r2Key !== media.r2Key
      || !belongsToR2Prefix(binding.r2Key, binding.r2KeyPrefix)
      || binding.sizeBytes !== media.sizeBytes
      || normalizeSha256(binding.contentHash) === null
      || normalizeSha256(binding.contentHash) !== normalizeSha256(media.contentHash)) {
      throw new TemplateHqTemplateError('SOURCE_MEDIA_AUTHORITY_MISMATCH', 422);
    }
  }
}

async function loadAuthorizedSource(
  authority: MessageTemplateSourceAuthority,
  templateVersionId: string,
  dependencies: MessageTemplateAdapterDependencies,
): Promise<AuthorizedMessageTemplateSource> {
  if (!authority.tenantId || !authority.sourceAccountId || !templateVersionId || /\s/.test(templateVersionId)) {
    throw new TemplateHqTemplateError('SOURCE_AUTHORITY_INVALID', 422);
  }
  const version = await dependencies.resolveSourceVersion({ authority, templateVersionId });
  if (!version
    || version.tenantId !== authority.tenantId
    || version.sourceAccountId !== authority.sourceAccountId
    || version.templateVersionId !== templateVersionId) {
    throw new TemplateHqTemplateError('SOURCE_AUTHORITY_MISMATCH', 422);
  }
  const definition = parseSourceDefinition(version);
  const bindings = new Map<string, MessageTemplateSourceMediaBinding>();
  for (const binding of version.media) {
    if (bindings.has(binding.mediaId)) {
      throw new TemplateHqTemplateError('SOURCE_MEDIA_AUTHORITY_MISMATCH', 422);
    }
    bindings.set(binding.mediaId, binding);
  }
  const source = { authority, version, definition, media: bindings };
  assertAuthorizedSource(source, authority.tenantId, templateVersionId);
  return source;
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
}

function allTemplateText(definition: MessageTemplateDefinition): string {
  const template = definition.template;
  return [
    template.messageContent,
    template.carouselActionsJson,
    template.carouselTapLimitText,
    template.questionJson,
  ].filter((value): value is string => value !== null).join('\n');
}

/** Only media actually referenced by the template body is distributed. */
export function referencedMedia(definition: MessageTemplateDefinition): readonly MessageTemplateMediaDefinition[] {
  const body = allTemplateText(definition);
  const references = definition.media.filter((media) =>
    [media.id, media.r2Key, media.publicUrl].some((locator) => locator !== null && body.includes(locator)),
  );
  const declaredLocators = new Map<string, string>();
  for (const media of references) {
    for (const locator of [media.id, media.r2Key, media.publicUrl]) {
      if (!locator) continue;
      const previous = declaredLocators.get(locator);
      if (previous && previous !== media.id) {
        throw new TemplateHqTemplateError('AMBIGUOUS_MEDIA_REFERENCE', 409);
      }
      declaredLocators.set(locator, media.id);
    }
  }
  return references;
}

function uniqueMatch<T>(items: readonly T[], errorCode: string): T | null {
  if (items.length > 1) throw new TemplateHqTemplateError(errorCode, 409);
  return items[0] ?? null;
}

/** Produces the template and every referenced-media choice shown during preflight. */
export function inspectMessageTemplateDefinition(
  definition: MessageTemplateDefinition,
  snapshot: MessageTemplateTargetSnapshot,
): readonly MessageTemplatePreflightItem[] {
  const targetTemplate = uniqueMatch(
    snapshot.templates.filter((item) => normalizeName(item.name) === normalizeName(definition.template.name)),
    'AMBIGUOUS_TEMPLATE',
  );
  const result: MessageTemplatePreflightItem[] = [{
    sourceId: `template:${definition.template.id}`,
    itemKind: 'template',
    name: definition.template.name,
    targetId: targetTemplate?.id ?? null,
    expectedRevision: targetTemplate?.updatedAt ?? null,
    duplicate: targetTemplate !== null,
    allowedModes: targetTemplate ? ['overwrite', 'alias'] : ['create'],
  }];
  for (const media of referencedMedia(definition)) {
    const targetMedia = uniqueMatch(
      snapshot.media.filter((item) => item.contentHash === media.contentHash),
      'AMBIGUOUS_MEDIA',
    );
    result.push({
      sourceId: `media:${media.id}`,
      itemKind: 'media',
      name: media.filename,
      targetId: targetMedia?.id ?? null,
      expectedRevision: targetMedia?.revision ?? null,
      duplicate: targetMedia !== null,
      allowedModes: targetMedia ? ['overwrite', 'alias'] : ['create'],
    });
  }
  return result;
}

export function nextMessageTemplateAlias(name: string, occupiedNames: readonly string[]): string {
  const occupied = new Set(occupiedNames.map(normalizeName));
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${name} (${suffix})`;
    if (!occupied.has(normalizeName(candidate))) return candidate;
  }
  throw new TemplateHqTemplateError('ALIAS_EXHAUSTED', 409);
}

function replaceAll(value: string | null, replacements: ReadonlyMap<string, string>): string | null {
  if (value === null) return null;
  const sources = [...replacements.keys()].sort((left, right) => right.length - left.length);
  if (sources.length === 0) return value;
  const pattern = new RegExp(sources.map((source) => source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  // String.replace scans the original input once; generated ids/URLs are never treated as source locators.
  return value.replace(pattern, (source) => replacements.get(source)!);
}

function requireResolution(
  item: MessageTemplatePreflightItem,
  resolutions: readonly HqTemplateResolution[],
): HqTemplateResolution {
  const resolution = resolutions.find((entry) => entry.sourceId === item.sourceId);
  if (!resolution || resolution.itemKind !== item.itemKind || !item.allowedModes.includes(resolution.mode)) {
    throw new TemplateHqTemplateError('SELECTION_REQUIRED', 409);
  }
  if (item.duplicate && resolution.mode === 'overwrite') {
    if (resolution.targetId !== item.targetId || resolution.expectedRevision !== item.expectedRevision) {
      throw new TemplateHqTemplateError(VERSION_CONFLICT_MESSAGE, 409);
    }
  }
  return resolution;
}

function conflictGuard(sql: string, bindings: readonly HqTemplateBinding[]): HqTemplateStatement {
  // Malformed JSON is evaluated only on mismatch and aborts the surrounding atomic D1 batch.
  return {
    sql: `SELECT CASE WHEN EXISTS(${sql}) THEN 1 ELSE json_extract('VERSION_CONFLICT', '$') END`,
    bindings,
  };
}

export async function planMessageTemplateDistribution(input: {
  context: HqTemplateAdapterContext;
  source: AuthorizedMessageTemplateSource;
  snapshot: MessageTemplateTargetSnapshot;
  idMap: Readonly<Record<string, string>>;
  dependencies: MessageTemplateAdapterDependencies;
}): Promise<HqTemplateStoreAtomicCommitPlan> {
  const { context, source, snapshot, idMap, dependencies } = input;
  const { definition } = source;
  assertAuthorizedSource(source, context.tenantId, source.version.templateVersionId);
  if (snapshot.tenantId !== context.tenantId
    || snapshot.targetAccountId !== context.targetAccountId
    || snapshot.snapshotToken !== context.snapshotToken) {
    throw new TemplateHqTemplateError(VERSION_CONFLICT_MESSAGE, 409);
  }
  const items = inspectMessageTemplateDefinition(definition, snapshot);
  if (context.resolutions.length !== items.length
    || new Set(context.resolutions.map((entry) => entry.sourceId)).size !== items.length) {
    throw new TemplateHqTemplateError('SELECTION_REQUIRED', 409);
  }
  const now = dependencies.now();
  const dbCommit: HqTemplateStatement[] = [];
  const stage: HqTemplateStoreAtomicCommitPlan['stage'][number][] = [];
  const compensateOnDbFailure: HqTemplateStoreAtomicCommitPlan['compensateOnDbFailure'][number][] = [];
  const reconcile: HqTemplateStoreAtomicCommitPlan['reconcile'][number][] = [];
  const replacements = new Map<string, string>();
  const resolved: HqTemplateResolution[] = [];
  const occupiedTemplateNames = [...snapshot.templates.map((entry) => entry.name)];
  const occupiedMediaNames = [...snapshot.media.map((entry) => entry.filename)];

  for (const item of items) {
    const resolution = requireResolution(item, context.resolutions);
    const targetId = idMap[item.sourceId];
    if (!targetId || /\s/.test(targetId)) throw new TemplateHqTemplateError('INVALID_ID_MAP', 409);
    let name = item.name;
    if (resolution.mode === 'alias') {
      const occupied = item.itemKind === 'template' ? occupiedTemplateNames : occupiedMediaNames;
      const generated = nextMessageTemplateAlias(item.name, occupied);
      if (resolution.aliasName && normalizeName(resolution.aliasName) !== normalizeName(generated)) {
        throw new TemplateHqTemplateError('ALIAS_SELECTION_CONFLICT', 409);
      }
      name = generated;
      occupied.push(name);
    }
    if (resolution.mode !== 'overwrite') {
      const table = item.itemKind === 'template' ? 'templates' : 'media';
      const column = item.itemKind === 'template' ? 'name' : 'filename';
      dbCommit.push({
        // A concurrent same-name insert makes the INSERT below fail this guard in the same batch.
        sql: `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ${table} WHERE line_account_id = ? AND lower(trim(${column})) = lower(trim(?))) THEN 1 ELSE json_extract('DUPLICATE_NAME', '$') END`,
        bindings: [context.targetAccountId, name],
      });
    }
    resolved.push({
      ...resolution,
      targetId,
      aliasName: resolution.mode === 'alias' ? name : undefined,
      expectedRevision: item.expectedRevision ?? undefined,
    });
  }

  for (const media of referencedMedia(definition)) {
    const sourceId = `media:${media.id}`;
    const item = items.find((entry) => entry.sourceId === sourceId)!;
    const resolution = requireResolution(item, context.resolutions);
    const targetId = idMap[sourceId];
    const target = snapshot.media.find((entry) => entry.id === item.targetId);
    const plannedResolution = resolved.find((entry) => entry.sourceId === sourceId)!;
    const filename = plannedResolution.aliasName ?? media.filename;
    const targetR2Key = dependencies.createTargetR2Key(media, targetId, context);
    const targetPublicUrl = dependencies.createTargetPublicUrl(targetR2Key, media, context);
    const ownerToken = dependencies.createOwnerToken(targetR2Key, context);
    if (!targetR2Key || !ownerToken || /\s/.test(ownerToken)) {
      throw new TemplateHqTemplateError('MEDIA_COPY_INVALID', 422);
    }
    const binding = source.media.get(media.id);
    if (!binding) throw new TemplateHqTemplateError('SOURCE_MEDIA_AUTHORITY_MISMATCH', 422);
    const sourceObject = await dependencies.readSourceObjectIfUnchanged({
      authority: source.authority,
      templateVersionId: source.version.templateVersionId,
      media,
      binding,
    });
    const declaredHash = normalizeSha256(media.contentHash);
    if (!sourceObject
      || (binding.etag !== null && sourceObject.etag !== binding.etag)
      || sourceObject.bytes.byteLength !== media.sizeBytes
      || declaredHash === null
      || await sha256Hex(sourceObject.bytes) !== declaredHash
      || (media.publicUrl !== null && targetPublicUrl === null)) {
      throw new TemplateHqTemplateError('MEDIA_COPY_INVALID', 422);
    }
    stage.push({ key: targetR2Key, ownerToken, bytes: sourceObject.bytes, contentType: media.mimeType });
    compensateOnDbFailure.push({ key: targetR2Key, ownerToken });
    reconcile.push({ key: targetR2Key, ownerToken });
    replacements.set(media.id, targetId);
    replacements.set(media.r2Key, targetR2Key);
    if (media.publicUrl && targetPublicUrl) replacements.set(media.publicUrl, targetPublicUrl);

    if (resolution.mode === 'overwrite') {
      if (!target) throw new TemplateHqTemplateError(VERSION_CONFLICT_MESSAGE, 409);
      dbCommit.push(conflictGuard(
        `SELECT 1 FROM media m JOIN media_versions v ON v.media_id = m.id
          WHERE m.id = ? AND m.line_account_id = ? AND m.r2_key = ?
            AND v.version_no = (SELECT MAX(v2.version_no) FROM media_versions v2 WHERE v2.media_id = m.id)
            AND (v.created_at || ':' || COALESCE(v.content_hash, '') || ':' || v.r2_key) = ?`,
        [targetId, context.targetAccountId, target.r2Key, item.expectedRevision],
      ));
      dbCommit.push({
        sql: `UPDATE media SET filename=?,kind=?,mime_type=?,size_bytes=?,width=?,height=?,duration_ms=?,r2_key=?,public_url=?
              WHERE id=? AND line_account_id=? AND r2_key=?`,
        bindings: [filename, media.kind, media.mimeType, media.sizeBytes, media.width, media.height,
          media.durationMs, targetR2Key, targetPublicUrl, targetId, context.targetAccountId, target.r2Key],
      });
    } else {
      dbCommit.push({
        sql: `INSERT INTO media
              (id,line_account_id,folder_id,kind,filename,mime_type,size_bytes,width,height,duration_ms,r2_key,public_url,uploaded_by,created_at)
              VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,NULL,?)`,
        bindings: [targetId, context.targetAccountId, media.kind, filename, media.mimeType, media.sizeBytes,
          media.width, media.height, media.durationMs, targetR2Key, targetPublicUrl, now],
      });
    }
    dbCommit.push({
      sql: `INSERT INTO media_versions
            (id,media_id,version_no,r2_key,mime_type,size_bytes,width,height,duration_ms,content_hash,scan_status,scanned_at,created_at,published_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,'verified',?,?,?)`,
      bindings: [dependencies.createId('media_version', media.versionId, context), targetId,
        resolution.mode === 'overwrite' ? target!.versionNo + 1 : 1, targetR2Key, media.mimeType,
        media.sizeBytes, media.width, media.height, media.durationMs, media.contentHash, now, now, now],
    });
  }

  const rootItem = items[0]!;
  const rootResolution = requireResolution(rootItem, context.resolutions);
  const targetTemplateId = idMap[rootItem.sourceId]!;
  const rootName = resolved[0]?.aliasName ?? definition.template.name;
  const template = definition.template;
  const messageContent = replaceAll(template.messageContent, replacements)!;
  const carouselActionsJson = replaceAll(template.carouselActionsJson, replacements);
  const carouselTapLimitText = replaceAll(template.carouselTapLimitText, replacements);
  const questionJson = replaceAll(template.questionJson, replacements);
  if (rootResolution.mode === 'overwrite') {
    dbCommit.push(conflictGuard(
      'SELECT 1 FROM templates WHERE id = ? AND line_account_id = ? AND updated_at = ?',
      [targetTemplateId, context.targetAccountId, rootItem.expectedRevision],
    ));
    dbCommit.push({
      sql: `UPDATE templates SET name=?,category=?,message_type=?,message_content=?,carousel_actions_json=?,
            carousel_tap_limit_mode=?,carousel_tap_limit_text=?,question_json=?,question_status=?,
            published_version=published_version+1,published_at=?,draft_message_type=NULL,draft_message_content=NULL,
            draft_carousel_actions_json=NULL,draft_carousel_tap_limit_mode=NULL,draft_carousel_tap_limit_text=NULL,
            draft_question_json=NULL,draft_question_status=NULL,draft_revision=0,updated_at=?
            WHERE id=? AND line_account_id=? AND updated_at=?`,
      bindings: [rootName, template.category, template.messageType, messageContent, carouselActionsJson,
        template.carouselTapLimitMode, carouselTapLimitText, questionJson, template.questionStatus,
        now, now, targetTemplateId, context.targetAccountId, rootItem.expectedRevision],
    });
  } else {
    dbCommit.push({
      sql: `INSERT INTO templates
            (id,name,category,message_type,message_content,carousel_actions_json,carousel_tap_limit_mode,
             carousel_tap_limit_text,question_json,question_status,created_at,updated_at,line_account_id,
             published_version,published_at,draft_revision)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,0)`,
      bindings: [targetTemplateId, rootName, template.category, template.messageType, messageContent,
        carouselActionsJson, template.carouselTapLimitMode, carouselTapLimitText, questionJson,
        template.questionStatus, now, now, context.targetAccountId, now],
    });
  }
  for (const media of referencedMedia(definition)) {
    dbCommit.push({
      sql: `INSERT INTO media_usages(media_id,ref_kind,ref_id,scanned_at) VALUES (?,'template',?,?)
            ON CONFLICT(media_id,ref_kind,ref_id) DO UPDATE SET scanned_at=excluded.scanned_at`,
      bindings: [idMap[`media:${media.id}`], targetTemplateId, now],
    });
  }

  return {
    tenantId: context.tenantId,
    targetAccountId: context.targetAccountId,
    preflightId: context.preflightId,
    idempotencyFingerprint: context.idempotencyFingerprint,
    snapshotToken: context.snapshotToken,
    mode: context.mode,
    resolutions: resolved,
    stage,
    dbCommit,
    compensateOnDbFailure,
    reconcile,
  };
}

function referenceSource(reference: HqTemplateReference): AuthorizedMessageTemplateSource {
  const metadata = reference as Partial<MessageTemplateReferenceMetadata>;
  if (!metadata.source) throw new TemplateHqTemplateError('INVALID_REFERENCE', 422);
  return metadata.source;
}

/**
 * Runtime wiring binds an authenticated source authority and supplies tenant-scoped D1/R2
 * operations without expanding the shared adapter contract. input.definitionJson is deliberately
 * ignored: the immutable version selected by input.templateVersionId is the only source of truth.
 */
export function createTemplateHqTemplateAdapter(
  authority: MessageTemplateSourceAuthority,
  dependencies: MessageTemplateAdapterDependencies,
): HqTemplateAdapter {
  return {
    type: 'template',
    async extractReferences(input) {
      const source = await loadAuthorizedSource(authority, input.templateVersionId, dependencies);
      const references: MessageTemplateReferenceMetadata[] = [{
        kind: 'template',
        sourceId: `template:${source.definition.template.id}`,
        source,
      }];
      for (const media of referencedMedia(source.definition)) {
        references.push({ kind: 'media', sourceId: `media:${media.id}`, source });
      }
      return { kind: 'OK', value: references };
    },
    async verifyReferences(context, references) {
      if (context.tenantId !== authority.tenantId) {
        throw new TemplateHqTemplateError('SOURCE_AUTHORITY_MISMATCH', 422);
      }
      const snapshot = await dependencies.loadTargetSnapshot(context);
      if (snapshot.tenantId !== context.tenantId
        || snapshot.targetAccountId !== context.targetAccountId
        || snapshot.snapshotToken !== context.snapshotToken) {
        throw new TemplateHqTemplateError(VERSION_CONFLICT_MESSAGE, 409);
      }
      const source = referenceSource(references[0]!);
      if (source.authority.tenantId !== authority.tenantId
        || source.authority.sourceAccountId !== authority.sourceAccountId) {
        throw new TemplateHqTemplateError('SOURCE_AUTHORITY_MISMATCH', 422);
      }
      const items = inspectMessageTemplateDefinition(source.definition, snapshot);
      const verified: VerifiedReference[] = references.map((reference) => {
        const item = items.find((candidate) => candidate.sourceId === reference.sourceId);
        if (!item || item.itemKind !== reference.kind) {
          throw new TemplateHqTemplateError('INVALID_REFERENCE', 422);
        }
        return {
          kind: reference.kind,
          sourceId: reference.sourceId,
          targetId: item.targetId ?? dependencies.createId(item.itemKind, item.sourceId, context),
          duplicate: item.duplicate,
          expectedRevision: item.expectedRevision,
        };
      });
      return { kind: 'OK', value: verified };
    },
    async detectDuplicates(_context, references) {
      const duplicates = (references as readonly VerifiedReference[])
        .filter((reference) => reference.duplicate)
        .map((reference) => ({
          sourceId: reference.sourceId,
          targetId: reference.targetId,
          reason: reference.kind === 'template' ? 'same_name' : 'same_content',
        }));
      return { kind: 'OK', value: duplicates };
    },
    async buildIdMap(context, references) {
      const map: Record<string, string> = {};
      for (const reference of references as readonly VerifiedReference[]) {
        const resolution = context.resolutions.find((entry) => entry.sourceId === reference.sourceId);
        if (!resolution) throw new TemplateHqTemplateError('SELECTION_REQUIRED', 409);
        if ((reference.duplicate && resolution.mode === 'create')
          || (!reference.duplicate && resolution.mode !== 'create')) {
          throw new TemplateHqTemplateError('SELECTION_REQUIRED', 409);
        }
        if (resolution.mode === 'overwrite') {
          if (!reference.duplicate || resolution.targetId !== reference.targetId
            || resolution.expectedRevision !== reference.expectedRevision) {
            throw new TemplateHqTemplateError(VERSION_CONFLICT_MESSAGE, 409);
          }
          map[reference.sourceId] = reference.targetId;
        } else {
          map[reference.sourceId] = dependencies.createId(
            reference.kind === 'template' ? 'template' : 'media',
            reference.sourceId,
            context,
          );
        }
      }
      return { kind: 'OK', value: map };
    },
    async buildCommitPlan(context, input, idMap) {
      if (context.tenantId !== authority.tenantId) {
        throw new TemplateHqTemplateError('SOURCE_AUTHORITY_MISMATCH', 422);
      }
      const source = await loadAuthorizedSource(authority, input.templateVersionId, dependencies);
      const snapshot = await dependencies.loadTargetSnapshot(context);
      return {
        kind: 'OK',
        value: await planMessageTemplateDistribution({ context, source, snapshot, idMap, dependencies }),
      };
    },
  };
}

/** Registry stays fail-closed until the router supplies the D1/R2 dependency factory. */
export const templateHqTemplateAdapter = unsupportedHqTemplateAdapter('template');
