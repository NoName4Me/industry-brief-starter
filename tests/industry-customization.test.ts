import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../scripts/migrate.ts';
import { pool } from '../src/server/db.ts';
import { defaultSettings } from '../src/server/types.ts';
import { saveSettings } from './model-settings-fixture.ts';
import { getQueue } from '../src/server/queue.ts';
import { collectSource } from '../src/server/collect.ts';
import { saveSourceConfig, toggleSource } from '../src/server/source-config.ts';
import { verifySource } from '../src/server/source-verification.ts';
import { screenPendingArticles } from '../src/server/article-screening.ts';
import { processArticle } from '../src/server/process.ts';
import { generateDaily } from '../src/server/daily.ts';
import { publishBrief } from '../src/server/briefs.ts';
import { publicationIndustryId } from '../src/publication/identity.ts';

if (!process.env.DATABASE_URL || !/_test$/.test(new URL(process.env.DATABASE_URL).pathname))
  throw new Error('行业定制测试必须连接独立测试库');

after(() => pool.end());

test('按三栏行业配置验证和采集信源，筛除无关资料，归组并发布日报', async () => {
  await migrate();
  await pool.query(
    'TRUNCATE briefs, articles, events, sources, edition_runs, processing_steps, model_calls CASCADE',
  );
  const boss = await getQueue();
  const originalFetch = globalThis.fetch;
  try {
    const scope = '收录影响债权回收、破产重整和资产处置的可核对进展';
    const sections = ['政策与监管', '破产重整与执行', '资产交易与处置'];
    await saveSettings({
      ...defaultSettings,
      editorialPrompt: scope,
      sections: sections.map((name) => ({
        name,
        description: name,
        minItems: 0,
        maxItems: 3,
        budget: 400,
      })),
      startDate: '2026-10-20',
      modelOffPeakOnly: false,
      highlightsEnabled: false,
      reviewEnabled: false,
      autoPublish: false,
    });

    const entries = [
      {
        title: '甲公司债权人会议公告',
        excerpt: '管理人发布甲公司债权人会议安排及申报截止日期。',
        hour: 12,
      },
      {
        title: '甲公司债权人会议公告转载',
        excerpt: '管理人发布甲公司债权人会议安排及申报截止日期。',
        hour: 13,
      },
      { title: '普通相邻关系诉讼消息', excerpt: '该案仅涉及相邻房屋通行安排。', hour: 14 },
    ].map((entry, index) => ({
      ...entry,
      url: 'https://1.1.1.1/industry-brief-fixture/' + index,
      publishedAt: '2026-10-21T' + entry.hour + ':00:00Z',
    }));
    const fetchSource = async (url: string) => JSON.stringify([entries[Number(url.at(-1))]]);
    for (const [index, entry] of entries.entries()) {
      const source = await saveSourceConfig(undefined, {
        name: '测试来源 ' + index,
        originAddress: entry.url,
        url: entry.url,
        format: 'json',
        sections: [sections[1]],
        priority: 'P1',
        verificationStatus: 'pending',
        verificationNote: '',
        notes: '',
        intervalMinutes: 60,
        autoInterval: false,
        minIntervalMinutes: 60,
        maxIntervalMinutes: 240,
      });
      assert.equal((await verifySource(source.id, fetchSource)).status, 'approved');
      await toggleSource(source.id, true);
      const result = await collectSource(source.id, fetchSource, new Date('2026-10-21T17:00:00Z'), {
        manual: true,
      });
      assert.equal(result.inserted, 1);
    }

    const assessment = Object.fromEntries(
      defaultSettings.ratingRules.map(({ id }) => [id, { score: 5, reason: '来自已提供的公告' }]),
    );
    const primary = entries[0];
    let screened = false;
    let matchedDuplicate = false;
    globalThis.fetch = async (_url, init) => {
      const messages = JSON.parse(String(init?.body)).messages;
      const system = messages[0].content as string;
      const input = JSON.parse(messages[1].content);
      if (input.articles) {
        assert.equal(input.scope, scope);
        screened = true;
        return reply({
          results: input.articles.map((article: { id: string; title: string }) => ({
            id: article.id,
            decision: article.title === entries[2].title ? 'BLOCK' : 'PASS',
            reason: '依照行业收录范围',
          })),
        });
      }
      if (input.article) {
        assert.ok(system.includes(scope));
        const duplicate = input.article.title === entries[1].title;
        const existingEventId = duplicate ? input.candidates[0]?.id : null;
        if (duplicate) {
          assert.ok(existingEventId, '转载应召回同一个案的事件');
          matchedDuplicate = true;
        }
        return reply({
          relevant: true,
          title: primary.title,
          summary: primary.excerpt,
          section: sections[1],
          assessment,
          scoreReason: '公告含可核对的事实',
          existingEventId,
          novelty: duplicate ? 'duplicate' : 'new',
          newFactIndexes: duplicate ? [] : [0],
          needsReview: false,
          conflict: false,
          facts: [
            { statement: primary.excerpt, status: 'announced', evidenceIds: ['S1'], entities: [] },
          ],
        });
      }
      if (input.selected)
        return reply({
          items: input.selected.map(({ id }: { id: string }) => ({
            eventId: id,
            title: primary.title,
            summary: primary.excerpt,
          })),
        });
      return reply({ title: '甲公司管理人公开债权人会议安排' });
    };

    const ready = await screenPendingArticles(new Date(Date.now() + 60_000));
    assert.equal(ready.length, 2);
    const pending = await pool.query(
      'SELECT id FROM articles WHERE id=ANY($1::uuid[]) ORDER BY published_at',
      [ready],
    );
    for (const row of pending.rows) await processArticle(row.id);
    assert.ok(screened && matchedDuplicate);
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM articles WHERE state='ignored'")).rows[0].n,
      1,
    );
    assert.deepEqual((await pool.query('SELECT industry_id FROM events')).rows, [
      { industry_id: publicationIndustryId },
    ]);

    const draft = await generateDaily('2026-10-22');
    assert.equal(draft.published, null);
    const issue = await publishBrief(draft.id, { suppressMail: true });
    assert.equal(issue.published?.format, 'daily-v1');
    assert.equal(issue.published?.items.length, 1);
    const item = issue.published?.items[0];
    assert.equal(item?.section, sections[1]);
    assert.deepEqual(
      item?.sources.map((source) => source.url).sort(),
      [entries[0].url, entries[1].url].sort(),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await boss.stop();
  }
});

function reply(value: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }),
  );
}
