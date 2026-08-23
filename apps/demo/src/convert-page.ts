import { bindConvert } from './convert-ui';

type PageConfig = {
  pkg: string;
  name: string;
};

const raw = document.getElementById('page-config')?.textContent ?? '{}';
const config = JSON.parse(raw) as PageConfig;

bindConvert({
  readyLabel: `Ready · running @mdgate/${config.pkg} locally`,
  copyIdle: 'Copy Markdown',
  copyDone: 'Copied',
  statsFor: (info) => `${info.format} detected · Converted locally`,
});
