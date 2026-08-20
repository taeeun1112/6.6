const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
// Serves the Desktop directory so we can access both projects
const PUBLIC_DIR = path.join(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Decode URL to handle Korean directory names properly and strip query parameters
  let reqPath = decodeURIComponent(req.url).split('?')[0];
  
  // If base route is requested, serve Screen 6 index.html directly
  if (reqPath === '/' || reqPath === '/index.html') {
    reqPath = '/산학 6번 데이터:홈페이지/index.html';
  }

  let filePath = path.join(PUBLIC_DIR, reqPath);
  
  // Default to index.html if request is a directory
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + reqPath);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\x1b[32m[Raduga System] Local server launched at http://localhost:${PORT}\x1b[0m`);
  console.log(`- Screen 6 (Thermal Dashboard): http://localhost:${PORT}/산학%206번%20데이터:홈페이지/index.html`);
});
