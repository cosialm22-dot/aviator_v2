"""Realtime WebSocket bridge for Playwright tests run behind an HTTPS proxy.

Chromium cannot open wss:// through the sandbox proxy, so the page's Supabase Realtime socket is
intercepted with Playwright's route_web_socket and relayed by a Python client (websocket-client,
which tunnels through HTTPS_PROXY with CONNECT). Playwright's sync API is single-threaded, so
messages from the server are queued by a reader thread and delivered by `pump()`, which the
test's wait loop calls. With no proxy configured, `install` does nothing and the browser
connects directly.
"""
import os, queue, re, threading, urllib.parse

try:
    import websocket  # websocket-client
except ImportError:  # pragma: no cover
    websocket = None

_bridges = []


class _Bridge:
    def __init__(self, route):
        self.route, self.q, self.closed = route, queue.Queue(), False
        p = urllib.parse.urlparse(os.environ["HTTPS_PROXY"])
        self.up = websocket.create_connection(
            route.url, http_proxy_host=p.hostname, http_proxy_port=p.port, proxy_type="http",
            sslopt={"ca_certs": os.environ.get("SSL_CERT_FILE") or "/root/.ccr/ca-bundle.crt"})
        route.on_message(lambda m: (not self.closed) and self.up.send(m if isinstance(m, str) else m.decode()))
        route.on_close(lambda *a: self.close())
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            while not self.closed:
                self.q.put(self.up.recv())
        except Exception:
            self.closed = True

    def pump(self):
        while not self.q.empty():
            try:
                self.route.send(self.q.get_nowait())
            except Exception:
                self.closed = True
                return

    def close(self):
        self.closed = True
        try: self.up.close()
        except Exception: pass


def install(context):
    """Route the realtime socket of every page in `context` through the proxy bridge."""
    if not os.environ.get("HTTPS_PROXY") or websocket is None:
        return
    context.route_web_socket(re.compile(r".*/realtime/v1/websocket.*"), lambda ws: _bridges.append(_Bridge(ws)))


def pump():
    for b in list(_bridges):
        if b.closed:
            _bridges.remove(b)
        else:
            b.pump()
