// Step-by-step guide for starting the Morph companion server on a computer (shown by the Downloader and Share links).
import { h } from './dom.js';

const REPO = 'https://github.com/Thunderlight333/Main-Apps-Repo';

export function serverSteps() {
  return h('div.prose.steps',
    h('h4', '1. Download Morph to your computer (once)'),
    h('ol',
      h('li', 'Open ', h('a.link-btn', { href: REPO, target: '_blank', rel: 'noopener' }, 'github.com/Thunderlight333/Main-Apps-Repo'), '.'),
      h('li', 'Click the green ', h('strong', 'Code'), ' button, then ', h('strong', 'Download ZIP'), '.'),
      h('li', 'Unzip it: on Windows, right-click the ZIP in Downloads → ', h('strong', 'Extract All'), '; on a Mac, double-click it.'),
      h('li', 'Inside you will find a folder called ', h('code', 'morph'), ' (it contains ', h('code', 'package.json'), ', ', h('code', 'server'), ' and ', h('code', 'src'), '). That is the Morph folder. For example: ', h('code', 'Downloads\\Main-Apps-Repo-main\\morph'), '. You can move it anywhere, such as Documents.')),
    h('h4', '2. Install Node.js (once)'),
    h('ol',
      h('li', 'Go to ', h('a.link-btn', { href: 'https://nodejs.org', target: '_blank', rel: 'noopener' }, 'nodejs.org'), ', download the ', h('strong', 'LTS'), ' version and install it (keep clicking Next).'),
      h('li', 'Optional but recommended: install ffmpeg for the best quality, MP3 downloads and exact trims. Windows: open Command Prompt and run ', h('code', 'winget install ffmpeg'), '. Mac: ', h('code', 'brew install ffmpeg'), '.')),
    h('h4', '3. Start the server'),
    h('ol',
      h('li', 'Open a terminal inside the ', h('code', 'morph'), ' folder. Windows: open the folder in File Explorer, click the address bar, type ', h('code', 'cmd'), ' and press Enter. Mac: right-click the folder → ', h('strong', 'New Terminal at Folder'), '.'),
      h('li', 'The first time only, run ', h('code', 'npm install'), ' (takes about a minute).'),
      h('li', 'Run ', h('code', 'npm run serve'), '. When you see ', h('code', 'Morph running: http://localhost:8787'), ' it is ready. Leave this window open; closing it (or pressing Ctrl+C) stops the server.')),
    h('h4', '4. Use it'),
    h('ul',
      h('li', 'On that computer, open ', h('code', 'http://localhost:8787'), '. The downloader and share links connect automatically.'),
      h('li', 'On your phone (same Wi-Fi), open the address shown after ', h('code', 'On your phone:'), ', for example ', h('code', 'http://192.168.1.20:8787'), '.'),
      h('li', 'Next time, just repeat step 3 without ', h('code', 'npm install'), '.')));
}
