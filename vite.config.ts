import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import pkg from './package.json' with { type: 'json' };
import { attachLicenseNotice, projectMetadata } from './scripts/project-metadata.mjs';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/coverage/**', '**/legacy/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  plugins: [
    monkey({
      entry: 'src/main.ts',
      server: { open: false },
      generate: ({ userscript, mode }) =>
        mode === 'build' ? attachLicenseNotice(userscript) : userscript,
      userscript: {
        ...projectMetadata,
        name: 'GitHub Fine-grained Token Profiles',
        namespace: 'https://github.com/',
        version: pkg.version,
        description: '保存/应用 GitHub 细粒度 Token 的仓库访问模式、权限与过期时间 profile',
        match: ['https://github.com/settings/personal-access-tokens/new*'],
        grant: 'none',
        'run-at': 'document-idle',
      },
      build: {
        autoGrant: false,
        fileName: 'github-token-profiles.user.js',
      },
    }),
  ],
});
