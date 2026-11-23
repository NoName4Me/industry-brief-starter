import { eq } from 'drizzle-orm';
import { publicationSources } from '../src/publication/sources.ts';
import { db, pool } from '../src/server/db.ts';
import { sources } from '../src/server/schema.ts';
import { saveSourceConfig } from '../src/server/source-config.ts';
import { verifySource } from '../src/server/source-verification.ts';

let failures = 0;
try {
  for (const entry of publicationSources) {
    const [existing] = await db.select().from(sources).where(eq(sources.url, entry.url));
    if (existing?.verificationStatus === 'approved') {
      console.log(entry.name, '已验证');
      continue;
    }
    try {
      const source =
        existing ??
        (await saveSourceConfig(undefined, {
          ...entry,
          originAddress: entry.url,
          verificationStatus: 'pending',
          verificationNote: '',
          priority: 'P1',
          notes: entry.notes ?? '',
          intervalMinutes: 60,
          autoInterval: false,
          minIntervalMinutes: 60,
          maxIntervalMinutes: 240,
        }));
      const result = await verifySource(source.id);
      console.log(entry.name, result.status, result.note);
      if (result.status !== 'approved') failures++;
    } catch (error) {
      failures++;
      console.error(entry.name, error instanceof Error ? error.message : '信源配置失败');
    }
  }
  if (failures) process.exitCode = 1;
} finally {
  await pool.end();
}
