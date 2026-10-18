const fs = require('node:fs/promises');
const path = require('node:path');

// Only whitelisted names are served, so a request path can never walk outside public/.
const EXACT = {
  '/': 'index.html', '/noodle/': 'noodle/game.html', '/overtime/': 'overtime/overlay.html', '/feeding/': 'feeding/game.html',
  ...Object.fromEntries(['app.js', 'diagnostics.js', 'console-shared.js', 'events.js', 'game-panels.js', 'style.css', 'logo.svg', 'app-icon.png',
    'noodle-console.js', 'noodle-console.css', 'overtime-console.js', 'overtime-console.css', 'feeding-console.js', 'feeding-console.css'].map(name => ['/' + name, name]))
};
const PATTERNS = [
  /^\/noodle\/(?:[a-z-]+\.(?:js|css)|assets\/[a-z_-]+\.(?:png|gif|svg))$/,
  /^\/overtime\/[a-z-]+\.(?:js|css|svg)$/,
  /^\/feeding\/(?:[a-z-]+\.(?:js|css)|assets\/(?:[a-z_]+\/)?[a-z_]+\.(?:png|svg))$/
];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif' };

function publicFile(pathname) {
  return EXACT[pathname] || (PATTERNS.some(pattern => pattern.test(pathname)) ? pathname.slice(1) : null);
}

async function servePublic(res, publicDir, pathname) {
  const file = publicFile(pathname);
  if (!file) return false;
  const body = await fs.readFile(path.join(publicDir, file));
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': /\.(png|gif)$/.test(file) ? 'public, max-age=86400' : 'no-cache' });
  res.end(body);
  return true;
}

module.exports = { publicFile, servePublic };
