import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from curl_cffi import requests

TOKEN = os.getenv("DISCORD_BOT_TOKEN")
PROXY_API_KEY = os.getenv("PROXY_API_KEY")

class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Allow a health check endpoint
        if self.path == '/health':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return

        # Check API key for all other requests
        if self.headers.get('x-api-key') != PROXY_API_KEY:
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"error":"unauthorized"}')
            print(f'[proxy] rejected unauthorized request to {self.path}')
            return

        # Forward request to Discord
        target_url = f"https://discord.com/api/v10{self.path}"
        
        try:
            # Using curl_cffi without impersonation to keep the request "raw" 
            # as you verified this works best for your specific case.
            r = requests.get(
                target_url,
                headers={"Authorization": f"Bot {TOKEN}"},
                timeout=15
            )
            
            self.send_response(r.status_code)
            self.end_headers()
            self.wfile.write(r.content)
            print(f'[proxy] GET {self.path} -> {r.status_code}')
            
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())
            print(f'[proxy] Error: {e}')

    # Block other methods to keep the proxy simple
    def do_POST(self): self.send_response(405)
    def do_PUT(self): self.send_response(405)
    def do_DELETE(self): self.send_response(405)
    def log_message(self, format, *args): pass

if __name__ == "__main__":
    server = HTTPServer(('0.0.0.0', 8080), ProxyHandler)
    print("[proxy] Server started on port 8080")
    server.serve_forever()
