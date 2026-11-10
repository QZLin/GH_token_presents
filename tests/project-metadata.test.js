import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import {
  attachLicenseNotice,
  createLicenseNotice,
  createProjectMetadata,
  licenseNotice,
  licenseText,
  projectMetadata,
} from '../scripts/project-metadata.mjs';
import { createDevelopmentUserscript } from '../scripts/dev-userscript.mjs';

function readMetadata(script, key) {
  return script.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'))?.[1];
}

describe('package-driven project metadata', () => {
  it('uses package.json as the author, copyright, license and project URL source', () => {
    expect(projectMetadata).toEqual({
      author: `${pkg.author.name} (${pkg.author.url})`,
      copyright: pkg.copyright,
      license: pkg.license,
      homepageURL: pkg.homepage,
      supportURL: pkg.bugs.url,
      source: pkg.homepage,
    });
    expect(Object.isFrozen(projectMetadata)).toBe(true);
  });
  it('supports standard string authors and repository URLs without retaining git+/.git', () => {
    const metadata = createProjectMetadata({
      ...pkg,
      author: 'Example Author',
      repository: 'git+https://example.com/project.git',
      bugs: 'https://example.com/issues',
    });
    expect(metadata.author).toBe('Example Author');
    expect(metadata.source).toBe('https://example.com/project');
    expect(metadata.supportURL).toBe('https://example.com/issues');
    expect(createProjectMetadata({ ...pkg, author: { name: 'Example Author' } }).author).toBe(
      'Example Author',
    );
  });
  it.each(['', 'Copyright\n// @grant *'])(
    'rejects empty/multiline metadata fields',
    (copyright) => {
      expect(() => createProjectMetadata({ ...pkg, copyright })).toThrow();
    },
  );
  it('requires the license and configured copyright notice to agree', () => {
    expect(licenseText).toContain(pkg.copyright);
    expect(() => createLicenseNotice(licenseText, 'Copyright 2000 Somebody Else')).toThrow(
      'LICENSE copyright',
    );
  });
  it('preserves the full license safely as comments, after metadata and before code', () => {
    const script = '// ==UserScript==\n// @name Example\n// ==/UserScript==\n(function () {})();';
    const result = attachLicenseNotice(script);
    expect(result.startsWith('// ==UserScript==')).toBe(true);
    expect(result).toContain(licenseNotice);
    expect(result.indexOf(licenseNotice)).toBeLessThan(result.indexOf('(function'));
    expect(
      licenseNotice
        .split('\n')
        .map((line) => line.slice(3))
        .join('\n'),
    ).toBe(licenseText);
    expect(attachLicenseNotice(result)).toBe(result);
    expect(() => attachLicenseNotice('not a userscript')).toThrow();
  });
  it('includes identical metadata and the full license in the isolated development script', () => {
    const script = createDevelopmentUserscript('http://127.0.0.1:5174', pkg.version);
    for (const [key, value] of Object.entries(projectMetadata))
      expect(readMetadata(script, key)).toBe(value);
    expect(script).toContain(licenseNotice);
    expect(script).toContain('@grant        GM_xmlhttpRequest');
    expect(script).not.toContain('__vite-plugin-monkey.entry.js');
  });
});
