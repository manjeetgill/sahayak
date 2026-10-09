"""Restricted pilot feedback frontend: HTTPS proxy -> private relay -> Mac SSH tunnel.

Only the connected pilot clinic's feedback page, its API actions and Next static
assets are served. Tokens stay in POST bodies; request bodies are never logged.
"""
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import posixpath
from urllib.parse import unquote, urlsplit

FORM = '/c/dr-sharma/feedback'
ACTIONS = {f'/public/dr-sharma/feedback/{action}'
           for action in ('open', 'response', 'resolution', 'stop')}


def allowed(method, target):
    parsed = urlsplit(target)
    path = unquote(parsed.path)
    if parsed.scheme or parsed.netloc or '\\' in path or posixpath.normpath(path) != path:
        return False
    if method == 'POST':
        return path in ACTIONS
    return method in ('GET', 'HEAD') and (path == FORM or path.startswith('/_next/static/'))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def forward(self):
        if not allowed(self.command, self.path):
            self.send_error(404)
            return
        if self.headers.get('Transfer-Encoding'):
            self.send_error(400)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self.send_error(400)
            return
        if not 0 <= length <= 16384 or (self.command == 'POST' and length == 0):
            self.send_error(413)
            return
        body = self.rfile.read(length) if length else None
        headers = {'Host': 'shayak.myalgodesk.in'}
        if self.command == 'POST':
            headers['Content-Type'] = 'application/json'
        conn = http.client.HTTPConnection('127.0.0.1', int(os.environ.get('FEEDBACK_UPSTREAM_PORT', '3000')), timeout=30)
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            response = conn.getresponse()
            data = response.read(16 * 1024 * 1024 + 1)
            if len(data) > 16 * 1024 * 1024:
                raise ValueError('Response too large')
            self.send_response(response.status)
            self.send_header('Content-Type', response.getheader('Content-Type', 'application/octet-stream'))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if self.command != 'HEAD':
                self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)
        except (OSError, http.client.HTTPException, ValueError):
            self.send_error(503, 'Clinic form temporarily unavailable')
        finally:
            conn.close()

    do_GET = forward
    do_HEAD = forward
    do_POST = forward


if __name__ == '__main__':
    ThreadingHTTPServer((os.environ.get('FEEDBACK_RELAY_HOST', '127.0.0.1'),
                         int(os.environ.get('FEEDBACK_RELAY_PORT', '3001'))), Handler).serve_forever()
