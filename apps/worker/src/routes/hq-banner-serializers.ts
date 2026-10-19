import { bannerReferencesFromRow, type BannerGeneration, type BannerImageWithDetail, type BannerProject, type Media } from '@line-crm/db';



export function serializeProject(p: BannerProject) {
  return {
    id: p.id,
    folderId: p.folder_id ?? null,
    name: p.name,
    description: p.description,
    isFavorite: p.is_favorite === 1,
    archivedAt: p.archived_at,
    imageCount: Number(p.image_count ?? 0),
    runningCount: Number(p.running_count ?? 0),
    createdBy: p.created_by,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export function parseTextLines(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 行ごとの「強調」（★修正案 `Svmg0`・2026-10-06 承認）。列が無い古い生成は
 * null なので空配列になり、「同じ条件で作る」で戻したときは全部オフになる。
 */
export function parseEmphasisLines(value: string | null | undefined): boolean[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((v) => v === true) : [];
  } catch {
    return [];
  }
}

export function serializeGeneration(g: BannerGeneration) {
  return {
    id: g.id,
    projectId: g.project_id,
    accountId:g.ai_account_id??null,
    status: g.status,
    mode: g.mode,
    presetKey: g.preset_key,
    aspectRatio: g.aspect_ratio,
    apiSize: g.api_size,
    quality: g.quality,
    textLines: parseTextLines(g.text_lines),
    emphasisLines: parseEmphasisLines(g.emphasis_lines),
    baseColor: g.base_color,
    mainColor: g.main_color,
    subColor: g.sub_color,
    accentColor: g.accent_color,
    personOption: g.person_option,
    customPrompt: g.custom_prompt,
    freePrompt: g.free_prompt,
    finalPrompt: g.final_prompt,
    engine: g.engine,
    modelName: g.model_name,
    requestedCount: g.requested_count,
    doneCount: g.done_count,
    failedCount: g.failed_count,
    unitsPerImage: g.units_per_image,
    errorMessage: g.error_message,
    // 参照画像は最大3枚（★BG-C `cOgWE`）。前の版で作った1枚組もここで同じ形になる。
    references: bannerReferencesFromRow(g),
    createdBy: g.created_by,
    createdAt: g.created_at,
    startedAt: g.started_at,
    finishedAt: g.finished_at,
  };
}

export function serializeMedia(m: Media, base: string) {
  return {
    id: m.id,
    filename: m.filename,
    mimeType: m.mime_type,
    sizeBytes: m.size_bytes,
    width: m.width,
    height: m.height,
    url: m.public_url ?? `${base}/images/${m.r2_key}`,
  };
}

export function serializeImage(i: BannerImageWithDetail, base: string) {
  return {
    id: i.id,
    folderId: i.folder_id ?? null,
    projectId: i.project_id,
    generationId: i.generation_id,
    sequence: i.sequence,
    source: i.source,
    parentImageId: i.parent_image_id,
    isFavorite: i.is_favorite === 1,
    createdBy: i.created_by,
    createdAt: i.created_at,
    media: serializeMedia(i.media, base),
    generation: i.generation ? serializeGeneration(i.generation) : null,
    deliveredAccountIds: i.delivered_account_ids,
  };
}
