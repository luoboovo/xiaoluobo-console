const fs = require('node:fs/promises');
const path = require('node:path');
const {imageEdge}=require('./render-images.cjs');

// Only whitelisted names are served, so a request path can never walk outside public/.
const EXACT = {
  '/': 'index.html', '/noodle/': 'noodle/game.html', '/overtime/': 'overtime/overlay.html', '/feeding/': 'feeding/game.html', '/lottery/':'lottery/game.html', '/number-bomb/':'number-bomb/game.html',
  ...Object.fromEntries(['app.js', 'diagnostics.js', 'console-shared.js', 'events.js', 'game-panels.js', 'style.css', 'logo.svg', 'app-icon.png',
    'noodle-console.js', 'noodle-console.css', 'overtime-console.js', 'overtime-console.css', 'feeding-console.js', 'feeding-console.css', 'lottery-console.js', 'lottery-console.css', 'number-bomb-console.js', 'number-bomb-console.css'].map(name => ['/' + name, name]))
};
const PATTERNS = [
  /^\/number-bomb\/[a-z-]+\.(?:js|css)$/,
  /^\/lottery\/[a-z-]+\.(?:js|css)$/,
  /^\/noodle\/(?:[a-z-]+\.(?:js|css)|assets\/[a-z_-]+\.(?:png|gif|svg))$/,
  /^\/overtime\/[a-z-]+\.(?:js|css|svg)$/,
  /^\/feeding\/(?:[a-z-]+\.(?:js|css)|assets\/(?:[a-z_]+\/)?[a-z_]+\.(?:png|svg))$/
];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif' };

function publicFile(pathname) {
  const rendered=pathname.match(/^\/noodle\/(?:render|thumb)\/([a-z_-]+)\.png$/);
  if(rendered)return 'noodle/assets/'+rendered[1]+'.png';
  const feeding=pathname.match(/^\/feeding\/thumb\/((?:[a-z_]+\/)?[a-z_]+\.png)$/);
  if(feeding)return 'feeding/assets/'+feeding[1];
  return EXACT[pathname] || (PATTERNS.some(pattern => pattern.test(pathname)) ? pathname.slice(1) : null);
}

async function servePublic(res, publicDir, pathname, images, cacheDir) {
  const file = publicFile(pathname);
  if (!file) return false;
  const source=path.join(publicDir,file),rendered=/^\/(?:noodle|feeding)\/(render|thumb)\//.exec(pathname);
  const body = rendered?await images.get(source,rendered[1]==='thumb'?128:imageEdge(path.basename(file,'.png')),cacheDir):await fs.readFile(source);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': /\.(png|gif)$/.test(file) ? 'public, max-age=86400' : 'no-cache' });
  res.end(body);
  return true;
}

module.exports = { publicFile, servePublic };
