export type PublicationSource = {
  name: string;
  url: string;
  format: 'rss' | 'json' | 'html';
  sections: string[];
  readDetails?: boolean;
  notes?: string;
};

// Add the verified public endpoints selected for the new publication here.
export const publicationSources: readonly PublicationSource[] = [];
