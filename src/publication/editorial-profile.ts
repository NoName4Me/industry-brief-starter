type InitialColumn = {
  name: string;
  minItems: number;
  maxItems: number;
  budget: number;
  description?: string;
  keywords?: string;
  weekdays?: number[];
  intervalWeeks?: number;
  lookbackDays?: number;
};

/** Initial editorial settings. Existing installations edit persisted settings in the admin UI. */
export const sampleScope =
  '围绕本刊栏目收录有明确主体、时间和可追溯依据的行业变化。重点考虑政策、机构实践、项目和风险等对读者有实质影响的进展。排除无关消息、缺乏实质事实的推广和仅重复背景的报道。';
export const defaultColumnDescriptions: Record<string, string> = {
  政策与监管: '优先依据正式文件，明确发布机构、适用范围、生效时间及实际变化。',
  技术与方法: '说明方法有何变化、适用条件及已公开的效果依据。',
  机构与实践: '说明机构实施了什么、实施条件和已有结果，保留来源归属。',
  项目与投资: '记录公开的项目、交易和采购进展，明确主体、规模和阶段。',
  风险与合规: '交代风险事件、处置动作、影响范围和证据支持的合规条件。',
  工具与资源: '介绍公开工具、数据和实务资源，说明使用条件与限制。',
  内部动态: '依据获准使用的内部材料记录进展，保留公开范围。',
};
export const sampleSections: InitialColumn[] = [
  { name: '政策与监管', minItems: 1, maxItems: 3, budget: 250 },
  { name: '技术与方法', minItems: 2, maxItems: 4, budget: 350 },
  { name: '机构与实践', minItems: 2, maxItems: 4, budget: 400 },
  { name: '项目与投资', minItems: 1, maxItems: 3, budget: 250 },
  { name: '风险与合规', minItems: 1, maxItems: 2, budget: 150 },
  { name: '工具与资源', minItems: 1, maxItems: 3, budget: 200 },
];
export const sampleRotations: InitialColumn[] = [
  {
    name: '一周观察',
    weekdays: [1],
    intervalWeeks: 1,
    lookbackDays: 7,
    minItems: 3,
    maxItems: 5,
    budget: 500,
    description: '回顾过去一周3—5个不同事件，只在材料支持时提炼趋势。',
  },
  {
    name: '他山之石',
    weekdays: [3],
    intervalWeeks: 2,
    lookbackDays: 14,
    minItems: 1,
    maxItems: 5,
    budget: 400,
    description: '拆解一家同业或厂商的做法与条件，材料不足时跳过。',
  },
  {
    name: '数据一图／观点摘编',
    weekdays: [5],
    intervalWeeks: 1,
    lookbackDays: 7,
    minItems: 1,
    maxItems: 5,
    budget: 300,
    description:
      '围绕一个主题选择可核对的数据或具名来源观点，不混写泛泛综述；纯文字可以，口径可比较时配图表。',
  },
];
export const sampleInternalColumn = {
  name: '内部动态',
  kind: 'fixed',
  enabled: false,
  minItems: 1,
  maxItems: 3,
  budget: 200,
  description: defaultColumnDescriptions['内部动态'],
};
export const sampleRatingRules = [
  {
    id: 'relevance',
    name: '相关性',
    description: '与收录主题及目标读者的相关程度。',
    weight: 30,
    enabled: true,
  },
  {
    id: 'impact',
    name: '影响面',
    description: '对行业、机构或使用者产生影响的范围和程度。',
    weight: 20,
    enabled: true,
  },
  {
    id: 'timeliness',
    name: '时效性',
    description: '事件的新近程度以及当前关注和处理的必要性。',
    weight: 20,
    enabled: true,
  },
  {
    id: 'actionability',
    name: '可行动性',
    description:
      '具体可用参考价值：1分仅了解动态；3分有场景但条件或效果不足；5分方法、要求或案例明确且关键条件有依据。不假设公司资源需求，不因写一句建议而加分。',
    weight: 20,
    enabled: true,
  },
  {
    id: 'novelty',
    name: '信息增量',
    description: '相对已有信息，新增事实或独特信息贡献的程度。',
    weight: 10,
    enabled: true,
  },
];
export const defaultKeywords = '';
export const defaultTitlePrompt =
  '从本期最重要的1—2件事提炼标题，写清具体主体及其动作或变化，让读者知道本期发生了什么。有共同主线时突出关联，没有必要时不强行并列。保留计划、研究结果和机构披露的事实边界，措辞准确、易懂，不混合不同事实。不使用日报定位、栏目名称等通用套话，不重复刊名。在字数上限内优先保证信息清晰，不为凑字数添加空话。';

export const sampleHighlightsPrompt =
  '30秒读完今天最值得知道的事项，突出事实、影响与必要条件，不重复栏目标题，不增加材料之外的信息。';

export const genericTitlePattern =
  /^(?:行业|产业|政策|监管)(?:与|和|及|行业|产业|政策|监管|发展|应用|技术|安全|实践|\s)*(?:观察|进展|动态|综述)$/;
