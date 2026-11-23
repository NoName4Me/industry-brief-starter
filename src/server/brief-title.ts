import { publicationName } from '../publication/identity.ts';

const names = [publicationName, '日报'].map((name) => name.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'));
const masthead = new RegExp(
  '^(?:《?(?:' + names.join('|') + ')》?(?:第\\d+期)?\\s*[｜|]\\s*)+',
  'i',
);

export function cleanBriefTitle(title: string) {
  return title.trim().replace(masthead, '').trim();
}
