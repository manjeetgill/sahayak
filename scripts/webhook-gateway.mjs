/* global process, URL */
import http from 'node:http';

const port = Number(process.env.WEBHOOK_GATEWAY_PORT ?? 5050);
const target = new URL(process.env.WEBHOOK_API_TARGET ?? 'http://127.0.0.1:4000');

function allowed(method, rawUrl) {
  const url = new URL(rawUrl ?? '/', 'http://localhost');
  if (url.pathname === '/webhooks/whatsapp') return method === 'POST' || method === 'GET';
  return false;
}

http
  .createServer((req, res) => {
    if (!allowed(req.method, req.url)) {
      res.writeHead(404).end();
      return;
    }
    const upstream = http.request(
      new URL(req.url, target),
      { method: req.method, headers: { ...req.headers, host: target.host } },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  })
  .listen(port, '127.0.0.1', () => {
    process.stdout.write(`Webhook gateway listening on 127.0.0.1:${port}\n`);
  });
