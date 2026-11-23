import { sourceDetailAdapters } from '../publication/source-adapters.ts';
import { load } from 'cheerio';
import type { SourceFetchOptions } from './fetch.ts';

export class UnsupportedSourceContentError extends Error {}

export async function readSourceDetail(
  url: string,
  fetcher: (url: string, options?: SourceFetchOptions) => Promise<string | null>,
) {
  const u = new URL(url);
  const adapter = sourceDetailAdapters.find((candidate) => candidate.matches(u));
  if (adapter) return adapter.read(u, fetcher);
  const html = await fetcher(url);
  if (!html) throw new Error('详情页返回空响应');
  const $ = load(html);
  const pdf = $('a[href$=".pdf"]').first().attr('href');
  const titleNode = $('h1,.article_title,.detail-title h3').first();
  const originalTitle = titleNode.text().replace(/\s+/g, ' ').trim();
  $(
    'script,style,nav,header,footer,iframe,.share,.print,[style*="display:none"],[style*="display: none"]',
  ).remove();
  const content = $(
    '[id="zoom"],#Zoom,#TRS_AUTOADD,#UCAP-CONTENT,.TRS_Editor,article,.article-content,.content-detail,#BodyLabel,.detail-cont,.detail-content,main',
  ).first();
  if (!content.length) throw new Error('详情页未识别到正文区域');
  let excerpt = content.text().replace(/\s+/g, ' ').trim();
  if (excerpt.length < 80 && pdf) {
    const attachment = new URL(pdf, url);
    if (attachment.origin !== u.origin) throw new Error('正文附件不属于同一官网');
    const data = await fetcher(attachment.href, { binaryBase64: true });
    if (!data) throw new Error('正文附件返回空响应');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({
      data: new Uint8Array(Buffer.from(data, 'base64')),
      useSystemFonts: true,
    });
    const doc = await loading.promise;
    try {
      const pages: string[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, 100); i++) {
        const page = await doc.getPage(i);
        const text = await page.getTextContent();
        pages.push(text.items.map((item) => ('str' in item ? item.str : '')).join(' '));
        if (pages.join(' ').length >= 12000) break;
      }
      excerpt = pages.join(' ').replace(/\s+/g, ' ').trim();
    } finally {
      await loading.destroy();
    }
  }
  if (content.find('img').length && /^[\s\d\p{P}\p{S}]*$/u.test(excerpt))
    throw new UnsupportedSourceContentError('详情页仅含图片，没有可读取的文字正文');
  if (excerpt.length < 20) throw new Error('详情页正文不足或仅含附件');
  const title = (
    originalTitle ||
    $('meta[name="ArticleTitle"],meta[property="og:title"]').attr('content') ||
    ''
  ).trim();
  return { excerpt: excerpt.slice(0, 12000), ...(title ? { title: title.slice(0, 500) } : {}) };
}
