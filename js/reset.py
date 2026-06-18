import os
import json
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

TOKEN = os.getenv("DISCORD_BOT_TOKEN")

class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return

        target_url = f"https://discord.com/api/v10{self.path}"
        req = urllib.request.Request(target_url, headers={
            "Authorization": f"Bot {TOKEN}",
            "Content-Type": "application/json"
        })

        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                self.send_response(response.status)
                self.end_headers()
                self.wfile.write(response.read())
                print(f'[proxy] GET {self.path} -> {response.status}')
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
            self.wfile.write(str(e.reason).encode())
            print(f'[proxy] GET {self.path} -> {e.code}')
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())
            print(f'[proxy] GET {self.path} -> 500: {e}')

    def do_POST(self):
        self.send_response(405)
        self.end_headers()

    def do_PUT(self): self.do_POST()
    def do_DELETE(self): self.do_POST()
    def log_message(self, format, *args): pass

if __name__ == "__main__":
    server = HTTPServer(('0.0.0.0', 8080), ProxyHandler)
    print("[proxy] Server started on port 8080")
    server.serve_forever()
