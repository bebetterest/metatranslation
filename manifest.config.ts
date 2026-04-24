import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'metatranslation',
  version: pkg.version,
  description:
    'Injects dual-line translations into web pages with hover alignment and vocabulary recording.',
  action: {
    default_title: 'Toggle metatranslation',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  options_page: 'src/options/index.html',
  permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
  host_permissions: ['<all_urls>'],
});
