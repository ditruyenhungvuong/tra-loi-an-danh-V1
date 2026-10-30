/* =========================================================
   Server tĩnh cho test E2E – Trả lời ẩn danh. Phục vụ thư mục app, KHÔNG sửa file gốc.
   Chép từ apps/checkin-vao-ca/tests/lib/static-server.js, chỉnh cho app này:
   khi trả js/config.js thì ép MOCK: true và MOCK_URL = cổng mock của test (8790) ngay lúc trả về,
   để js/config.js trên đĩa giữ nguyên dù đang MOCK: true hay false.
   Dùng: const { startStatic } = require('./static-server');
         const srv = await startStatic({ port: 8767, appDir, mockUrl: 'http://127.0.0.1:8790' });
         ... srv.close();
   ========================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

/* Đọc trước mọi file của app vào bộ nhớ: thư mục app nằm trên Google Drive, đọc lúc chạy có thể mất 1–2 s/file (Drive/AV quét) làm sai các mốc ≤ 3 s */
function preload(dir, base, cache) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) { if (!/^(tests|tools|\.git|node_modules)$/.test(name)) preload(full, base, cache); }
    else if (/\.(html|css|js|json|png|jpg|svg|ico)$/i.test(name)) cache.set(path.relative(base, full).split(path.sep).join('/'), fs.readFileSync(full));
  }
}
function startStatic(opts) {
  const appDir = path.resolve(opts.appDir);
  const cache = new Map();
  preload(appDir, appDir, cache);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.join(appDir, rel);
    const key = rel.split('\\').join('/');
    if (!file.startsWith(appDir) || !cache.has(key)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    let data = cache.get(key);
    if (rel.replace(/\\/g, '/') === 'js/config.js') {
      let src = data.toString('utf8');
      if (!/MOCK:\s*(true|false)/.test(src) || !/MOCK_URL:\s*'[^']*'/.test(src)) {
        throw new Error('js/config.js gốc phải có MOCK: true|false và MOCK_URL – test không chạy trên file đã sửa khác khuôn');
      }
      src = src.replace(/MOCK:\s*(true|false)/, 'MOCK: true');
      if (opts.mockUrl) src = src.replace(/MOCK_URL:\s*'[^']*'/, 'MOCK_URL: ' + JSON.stringify(opts.mockUrl));
      /* Cho phép test ghi đè vài hằng (ví dụ PUBLIC_URL) mà không đụng file trên đĩa */
      if (opts.overrides) {
        Object.keys(opts.overrides).forEach(k => {
          const re = new RegExp(k + ':\\s*[^,\\n]*');
          if (re.test(src)) src = src.replace(re, k + ': ' + JSON.stringify(opts.overrides[k]));
        });
      }
      data = Buffer.from(src, 'utf8');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port, '127.0.0.1', () => resolve({
      url: 'http://127.0.0.1:' + opts.port + '/',
      close: () => new Promise(r => server.close(r))
    }));
  });
}

module.exports = { startStatic };
