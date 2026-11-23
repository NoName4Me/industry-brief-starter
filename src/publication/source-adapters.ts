import type { fetchSource, SourceFetchOptions } from '../server/fetch.ts';
import type { Provenance } from '../server/types.ts';

export type SourceItem = {
  title: string;
  url: string;
  excerpt: string;
  publishedAt: string;
  sourceName?: string;
  provenance?: Provenance;
  publishedPrecision?: 'day' | 'time' | 'observed';
  contentComplete?: boolean;
};

export type SourceAdapter = {
  matches: (url: URL, format: string) => boolean;
  request?: (url: URL) => { url: string; options?: SourceFetchOptions };
  parse: (body: string, url: URL, now: Date) => SourceItem[] | Promise<SourceItem[]>;
};

// Register parsers for this publication here. Standard feeds need no adapter.
export const sourceAdapters: readonly SourceAdapter[] = [];

export type SourceDetailAdapter = {
  matches: (url: URL) => boolean;
  read: (url: URL, fetcher: typeof fetchSource) => Promise<{ excerpt: string; title?: string }>;
};

export const sourceDetailAdapters: readonly SourceDetailAdapter[] = [];
