import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import pkg from '../package.json' with { type: 'json' };

export function createProjectMetadata(info) {
  const person = info.author;
  const author =
    typeof person === 'string' ? person : `${person.name}${person.url ? ` (${person.url})` : ''}`;
  const repository = typeof info.repository === 'string' ? info.repository : info.repository.url;
  const source = repository.replace(/^git\+/, '').replace(/\.git$/, '');
  const metadata = {
    author,
    copyright: info.copyright,
    license: info.license,
    homepageURL: info.homepage,
    supportURL: typeof info.bugs === 'string' ? info.bugs : info.bugs.url,
    source,
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
      throw new Error(`package.json ${key} must be a non-empty, single-line string`);
    }
  }
  return Object.freeze(metadata);
}

export function createLicenseNotice(text, copyright) {
  if (!text.split(/\r?\n/).includes(copyright)) {
    throw new Error('LICENSE copyright must match package.json copyright');
  }
  // Line comments preserve the whole notice without allowing comment terminators
  // in a license to change the generated JavaScript's structure.
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `// ${line}`)
    .join('\n');
}

export const projectMetadata = createProjectMetadata(pkg);
export const licenseText = readFileSync(new NodeURL('../LICENSE', import.meta.url), 'utf8').trim();
export const licenseNotice = createLicenseNotice(licenseText, projectMetadata.copyright);

export function attachLicenseNotice(userscript) {
  const marker = '// ==/UserScript==';
  if (!userscript.includes(marker)) throw new Error('Missing userscript metadata boundary');
  if (userscript.includes(licenseNotice)) return userscript;
  return userscript.replace(marker, `${marker}\n\n${licenseNotice}`);
}
