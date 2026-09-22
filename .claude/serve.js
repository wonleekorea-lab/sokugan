const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = '/Users/wota/Documents/ChatGPT/AI Engineering/sokugan-work';
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(f, (e,d)=>{
    if (e) { res.writeHead(404, {'content-type':'text/plain'}).end('404 '+p); return; }
    res.writeHead(200, {'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control':'no-store'});
    res.end(d);
  });
}).listen(8788, '127.0.0.1', ()=>console.log('serving on 8788'));
