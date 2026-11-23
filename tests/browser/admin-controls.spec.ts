import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

test('信源菜单、采集开关和监控中的同题覆盖与日报采用', async ({ page }) => {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const ids = [randomUUID(), randomUUID()];
  const names = ids.map((id) => `监控来源-${id.slice(0, 6)}`);
  const original = (await db.query('SELECT value FROM settings WHERE id=1')).rows[0].value;
  const issue = (
    await db.query(
      "SELECT id,published,published_at FROM briefs WHERE kind='daily' AND period_date='2026-10-22'",
    )
  ).rows[0];
  const snapshot = structuredClone(issue.published);
  const eventIds = [issue.published.items[0].eventId, randomUUID(), randomUUID(), randomUUID()];
  try {
    for (const eventId of eventIds) {
      await db.query(
        "INSERT INTO events(id,industry_id,title,summary,section,score,occurred_at) VALUES($1,'general','监控事件','AI进展','政策与监管',80,now())",
        [eventId],
      );
    }
    for (const [index, sourceId] of ids.entries()) {
      await db.query(
        "INSERT INTO sources(id,name,url,format,industry_id,enabled,last_fetched_at,verification_status) VALUES($1,$2,$3,'rss','general',true,now(),'approved')",
        [sourceId, names[index], 'https://example.invalid/monitor/' + sourceId],
      );
      for (const eventId of eventIds.slice(0, 3 + index)) {
        const url = 'https://example.invalid/monitor/' + sourceId + '/' + eventId;
        await db.query(
          "INSERT INTO articles(source_id,source_name,industry_id,url,title,excerpt,published_at,state,event_id) VALUES($1,$2,'general',$3,'AI进展','AI进展材料',now(),'processed',$4)",
          [sourceId, names[index], url, eventId],
        );
        await db.query(
          "INSERT INTO source_discoveries(source_id,url,title,published_at,inserted) VALUES($1,$2,'AI进展',now(),true)",
          [sourceId, url],
        );
        if (eventId === eventIds[0]) {
          issue.published.items[0].sources.push({
            name: names[index],
            title: 'AI进展',
            url,
            publishedAt: new Date().toISOString(),
          });
        }
      }
    }
    await db.query('UPDATE briefs SET published=$2,published_at=now() WHERE id=$1', [
      issue.id,
      JSON.stringify(issue.published),
    ]);
    await page.goto('/login');
    await page.getByLabel('管理员密码').fill(process.env.ADMIN_PASSWORD!);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const nav = page.getByRole('navigation', { name: '管理导航' });
    await expect(nav.getByRole('link', { name: '信源管理', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '信源监控', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '手工导入', exact: true })).toHaveCount(0);
    await nav.getByRole('link', { name: '信源管理', exact: true }).click();
    await expect(page.getByRole('link', { name: '手工导入', exact: true })).toHaveCount(0);
    const toggle = page.getByRole('switch', { name: '自动采集', exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.goto('/admin/settings/runtime');
    await expect(page.getByLabel('开启自动采集')).toHaveCount(0);
    await page.getByRole('button', { name: '保存' }).click();
    await page.goto('/admin/sources/monitor');
    const overlap = page.getByRole('region', { name: '信源同题覆盖', exact: true });
    await expect(overlap).toContainText('共同 3 个事件');
    await expect(overlap).toContainText('100.0%');
    await expect(overlap).toContainText('75.0%');
    const quality = page.getByRole('region', { name: '信源质量列表' });
    for (const [index, name] of names.entries()) {
      const row = quality.getByRole('row').filter({ hasText: name });
      const cells = row.getByRole('cell');
      await expect(cells.nth(2)).toHaveText(String(3 + index));
      await expect(cells.nth(3)).toHaveText(String(3 + index));
      await expect(cells.nth(7)).toHaveText('1');
    }
    await page.screenshot({ path: '.data/source-monitor-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: '.data/source-monitor-mobile.png', fullPage: true });
    await page.goto('/admin/sources');
    await page.screenshot({ path: '.data/source-toolbar-mobile.png', fullPage: true });
  } finally {
    await db.query('UPDATE settings SET value=$1 WHERE id=1', [original]);
    await db.query('UPDATE briefs SET published=$2,published_at=$3 WHERE id=$1', [
      issue.id,
      JSON.stringify(snapshot),
      issue.published_at,
    ]);
    await db.query('DELETE FROM articles WHERE source_id=ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM sources WHERE id=ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM events WHERE id=ANY($1::uuid[])', [eventIds]);
    await db.end();
  }
});

test('订阅与推送顶部操作、时间字段和总开关', async ({ page }) => {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const original = (await db.query('SELECT value FROM settings WHERE id=1')).rows[0].value;
  const email = `controls-${randomUUID()}@example.invalid`;
  try {
    await db.query('UPDATE settings SET value=$1 WHERE id=1', [
      { ...original, deliveryEnabled: true },
    ]);
    await page.goto('/login');
    await page.getByLabel('管理员密码').fill(process.env.ADMIN_PASSWORD!);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/subscriptions');
    await page.getByRole('button', { name: '添加订阅', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '添加订阅' });
    await dialog.getByLabel('邮箱', { exact: true }).fill(email);
    await dialog.getByRole('button', { name: '添加订阅', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '记录时间' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '订阅类型' })).toHaveCount(0);
    const toggle = page.getByRole('switch', { name: '启动推送' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.getByRole('button', { name: '手动推送', exact: true }).click();
    await expect(page.getByText('推送已关闭，请先开启推送。')).toBeVisible();
    await expect(page.getByRole('button', { name: /推送至/ })).toBeDisabled();
    const closeButton = page.getByRole('dialog').getByRole('button', { name: '关闭' });
    await expect(closeButton.locator('svg')).toHaveCount(1);
    await closeButton.click();
    await page.screenshot({ path: '.data/subscriptions-desktop.png', fullPage: true });
    await page.getByRole('link', { name: '推送记录', exact: true }).click();
    await expect(page.getByRole('switch', { name: '启动推送' })).not.toBeChecked();
    await expect(page.getByRole('columnheader', { name: '推送时间' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: '.data/subscriptions-mobile.png', fullPage: true });
  } finally {
    await db.query('UPDATE settings SET value=$1 WHERE id=1', [original]);
    await db.query('DELETE FROM subscriptions WHERE email=$1', [email]);
    await db.end();
  }
});
