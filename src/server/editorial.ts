import {
  defaultColumnDescriptions,
  defaultKeywords,
  sampleInternalColumn,
  sampleRatingRules,
  sampleRotations,
  sampleSections,
} from '../publication/editorial-profile.ts';
export { defaultKeywords };
import { z } from 'zod';

export const sectionRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(40),
    aliases: z.array(z.string().min(1).max(40)).max(100).default([]),
    kind: z.enum(['fixed', 'rotation']).default('fixed'),
    enabled: z.boolean().default(true),
    description: z.string().trim().max(2000).default(''),
    keywords: z.string().trim().max(2000).default(''),
    minItems: z.number().int().min(0).max(20),
    maxItems: z.number().int().min(1).max(20),
    budget: z.number().int().min(50).max(3000),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1]),
    intervalWeeks: z.number().int().min(1).max(52).default(1),
    anchorDate: z.iso.date().default('2026-10-26'),
    lookbackDays: z.number().int().min(1).max(365).default(7),
  })
  .refine((v) => v.minItems <= v.maxItems, '条数下限不能高于上限')
  .transform((v) => ({ ...v, id: v.id ?? v.name }));
export type SectionRule = z.infer<typeof sectionRuleSchema>;
export const defaultSections = sampleSections.map((section) =>
  sectionRuleSchema.parse({
    ...section,
    description: defaultColumnDescriptions[section.name] ?? '',
  }),
);
export const defaultRotations = sampleRotations.map((section) =>
  sectionRuleSchema.parse({ ...section, kind: 'rotation' }),
);
export const defaultInternalColumn = sectionRuleSchema.parse(sampleInternalColumn);
export const defaultColumns = [...defaultSections, defaultInternalColumn, ...defaultRotations];
export function fixedSections(sections: SectionRule[]) {
  return sections.filter((s) => s.kind === 'fixed' && s.enabled);
}
export function resolveSection(name: string, sections: SectionRule[]) {
  return sections.find((s) => s.name === name || s.aliases.includes(name))?.name ?? name;
}
export const ratingRuleSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(2000),
    weight: z.number().min(0).max(100),
    enabled: z.boolean(),
  })
  .refine((r) => !r.enabled || r.weight > 0, '启用指标的权重必须大于0');
export type RatingRule = z.infer<typeof ratingRuleSchema>;
export const defaultRatingRules = sampleRatingRules.map((rule) => ratingRuleSchema.parse(rule));
export function normalizedRatingRules(rules: RatingRule[]) {
  const active = rules.filter((r) => r.enabled && r.weight > 0);
  const total = active.reduce((n, r) => n + r.weight, 0);
  return active.map((r) => ({ ...r, share: r.weight / total }));
}
// Upgrade existing JSON settings lazily; published editions are independent snapshots.
export function migrateEditorialSettings(input: unknown) {
  if (!input || typeof input !== 'object') return input;
  const old = input as Record<string, unknown>;
  if (old.editorialConfigVersion === 1) return migrateColumnKeywords(old);
  const sections = Array.isArray(old.sections) ? old.sections : defaultSections;
  const candidateRating =
    old.candidateRating ??
    (typeof old.minScore === 'number' ? Math.max(1, old.minScore / 20) : 3.5);
  return migrateColumnKeywords({
    ...old,
    editorialConfigVersion: 1,
    candidateRating,
    highlightRating: old.highlightRating ?? Math.max(4.3, Number(candidateRating)),
    sections: [
      ...sections,
      ...defaultRotations.map((r) => ({
        ...r,
        enabled: old.rotationsEnabled !== false,
        anchorDate: typeof old.rotationAnchor === 'string' ? old.rotationAnchor : r.anchorDate,
      })),
    ],
  });
}
function migrateColumnKeywords(value: Record<string, unknown>) {
  if (!Array.isArray(value.sections)) return value;
  const raw = typeof value.keywords === 'string' ? value.keywords : defaultKeywords;
  const sections = [...value.sections];
  if (
    value.internalColumnInitialized !== true &&
    !sections.some(
      (s) =>
        s &&
        typeof s === 'object' &&
        (s.name === '内部动态' || (Array.isArray(s.aliases) && s.aliases.includes('内部动态'))),
    )
  )
    sections.push(defaultInternalColumn);
  const mapping: Record<string, string[]> = {
    政策监管: ['政策与监管'],
    技术模型: ['技术与方法'],
    机构实践: ['机构与实践'],
    资本项目: ['项目与投资'],
    招投标: ['机构与实践'],
    风险安全: ['风险与合规'],
  };
  const normalize = (name: string) => name.replace(/[与／/、\s]/g, '');
  return {
    ...value,
    internalColumnInitialized: true,
    sections: sections.map((input) => {
      if (!input || typeof input !== 'object') return input;
      const original = input as Record<string, unknown>;
      const knownNames = [
        original.name,
        ...(Array.isArray(original.aliases) ? original.aliases : []),
      ];
      const fallbackDescription =
        knownNames
          .map((name) => (typeof name === 'string' ? defaultColumnDescriptions[name] : undefined))
          .find(Boolean) ?? '';
      const section: Record<string, unknown> = {
        ...original,
        description:
          typeof original.description === 'string' && original.description.trim()
            ? original.description
            : fallbackDescription,
      };
      if (Object.hasOwn(section, 'keywords')) return section;
      if (section.kind === 'rotation') return { ...section, keywords: '' };
      const names = [
        section.name,
        ...(Array.isArray(section.aliases) ? section.aliases : []),
      ].filter((name): name is string => typeof name === 'string');
      const keywords = raw
        .split('\n')
        .filter((line) => {
          const parts = line.split(/[：:]/);
          if (parts.length < 2) return true;
          const label = parts[0].trim();
          const targets = mapping[label];
          if (targets) return targets.some((target) => names.includes(target));
          const matched = value.sections as Record<string, unknown>[];
          const hasMatch = matched.some((s) =>
            [s.name, ...(Array.isArray(s.aliases) ? s.aliases : [])].some(
              (name) => typeof name === 'string' && normalize(name) === normalize(label),
            ),
          );
          return !hasMatch || names.some((name) => normalize(name) === normalize(label));
        })
        .map((line) => line.split(/[：:]/).at(-1)?.trim() ?? '')
        .filter(Boolean)
        .join('；');
      return { ...section, keywords };
    }),
  };
}
const dimension = z.object({
  score: z.number().int().min(1).max(5),
  reason: z.string().trim().min(1).max(400),
});
export const assessmentSchema = z
  .record(z.string().min(1).max(64), dimension)
  .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 30, '评分项数量无效');
export function assessmentFor(rules: RatingRule[]) {
  const active = normalizedRatingRules(rules);
  return assessmentSchema.superRefine((value, ctx) => {
    for (const rule of active)
      if (!value[rule.id])
        ctx.addIssue({
          code: 'custom',
          message: `缺少启用指标「${rule.name}」的评分，请重新处理资讯`,
        });
  });
}
export type Assessment = z.infer<typeof assessmentSchema>;
export const editionRecordSchema = z.object({
  section: z.string(),
  status: z.string(),
  candidate_count: z.number(),
  selected_count: z.number(),
  reason: z.string(),
  details: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        rating: z.number().nullable(),
        assessment: assessmentSchema.nullable(),
        ratingRules: z.array(ratingRuleSchema).optional(),
        selected: z.boolean(),
        reason: z.string(),
      }),
    )
    .default([]),
});
export const weights = {
  relevance: 0.3,
  impact: 0.2,
  timeliness: 0.2,
  actionability: 0.2,
  novelty: 0.1,
} as const;
export function ratingFor(value: unknown, rules: RatingRule[] = defaultRatingRules): number | null {
  const parsed = assessmentFor(rules).safeParse(value);
  const active = normalizedRatingRules(rules);
  if (!parsed.success || !active.length) return null;
  return (
    Math.round(active.reduce((sum, r) => sum + parsed.data[r.id].score * r.share, 0) * 100) / 100
  );
}
export function ratingForEditorial(editorial: unknown, rules: RatingRule[]) {
  const snapshot = editorial as { assessment?: unknown; ratingRules?: RatingRule[] } | null;
  const previous = snapshot?.ratingRules ?? defaultRatingRules;
  if (
    rules.some(
      (r) =>
        r.enabled && !previous.some((old) => old.id === r.id && old.description === r.description),
    )
  )
    return null;
  return ratingFor(snapshot?.assessment, rules);
}
export function weightedRating(value: Assessment, rules: RatingRule[] = defaultRatingRules) {
  const score = ratingFor(value, rules);
  if (score === null) throw new Error('缺少启用指标的评分，请重新处理资讯');
  return score;
}
export function displayRating(score: number) {
  return Math.round(score * 2) / 2;
}
export function keywordMatches(text: string, groups: string) {
  const haystack = text.toLowerCase();
  return [
    ...new Set(
      groups
        .split('\n')
        .flatMap((line) => (line.split(/[：:]/).at(-1) ?? '').split(/[；;,，]/))
        .map((s) => s.trim())
        .filter((term) => term && haystack.includes(term.toLowerCase())),
    ),
  ];
}
export function ratingInstructionsFor(rules: RatingRule[]) {
  const active = normalizedRatingRules(rules);
  return `各启用指标1—5整数分，每项提供来自材料的具体理由。assessment使用以下固定ID作为键，值为{score,reason}。assessment中不得放入scoreReason或任何非指标键。scoreReason是assessment的同级字段，必须作为顶层字符串返回。仅评估启用指标。总分由服务器按归一化权重计算，不要自行计算总分。指标：${JSON.stringify(active.map((r) => ({ id: r.id, name: r.name, description: r.description, percent: r.share * 100 })))}。`;
}
export const ratingInstructions = ratingInstructionsFor(defaultRatingRules);
export function evidenceMatches(excerpt: string, evidence: string) {
  const normalize = (text: string) => text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
  const needle = normalize(evidence);
  return needle.length > 0 && normalize(excerpt).includes(needle);
}
export function rotationRules(
  date: string,
  startDate: string,
  sections: SectionRule[] = defaultColumns,
) {
  const monday = (value: string) => {
    const d = new Date(`${value}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.getTime();
  };
  return sections
    .filter((r) => r.kind === 'rotation')
    .map((r) => {
      const weeks = Math.floor((monday(date) - monday(startDate)) / (7 * 86400000));
      return {
        ...r,
        anchorDate: startDate,
        lookbackDays: r.intervalWeeks * 7,
        days: r.intervalWeeks * 7,
        scheduled:
          r.enabled &&
          date >= startDate &&
          r.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) &&
          ((weeks % r.intervalWeeks) + r.intervalWeeks) % r.intervalWeeks === 0,
      };
    });
}
