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
  
  // If base route is requested, provide a landing page
  if (reqPath === '/' || reqPath === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Raduga Mobility Control Center</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #000;
            color: #fff;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          h1 {
            font-weight: 300;
            margin-bottom: 30px;
            letter-spacing: -0.5px;
          }
          .btn-container {
            display: flex;
            gap: 20px;
          }
          .btn {
            background: #1c1c1e;
            border: 1px solid #3a3a3c;
            color: #fff;
            padding: 15px 30px;
            font-size: 16px;
            border-radius: 12px;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s ease;
          }
          .btn:hover {
            background: #fff;
            color: #000;
          }
          .btn-sns {
            border-color: #1877f2;
            color: #1877f2;
          }
          .btn-sns:hover {
            background: #1877f2;
            color: #fff;
          }
        </style>
      </head>
      <body>
        <h1>Raduga Mobility Dual-Screen Control</h1>
        <div class="btn-container">
          <a class="btn" href="/산학 6번 데이터:홈페이지/index.html">Open Screen 6 (Thermal telemetry)</a>
          <a class="btn btn-sns" href="/산학 7번 SNS/index.html">Open Screen 7 (Facebook SNS)</a>
        </div>
      </body>
      </html>
    `);
    return;
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
  console.log(`- Screen 7 (SNS/Mosaic):        http://localhost:${PORT}/산학%207번%20SNS/index.html`);
});
