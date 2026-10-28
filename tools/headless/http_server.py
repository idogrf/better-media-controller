#!/usr/bin/python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Tiny cover server for the headless harness, on 127.0.0.1 only.

Usage: RUN_DIR=<run> python3 http_server.py

Serves $RUN_DIR/covers/. Paths: /<file> answers at once; /slow/<file> sends half the
body, waits 3 s, then sends the rest (so a download is visibly in flight); /missing/...
answers 404. Writes its random port to $RUN_DIR/http.port and its pid to
$RUN_DIR/http.pid (stop.sh kills it), and one "HEAD <path>" / "REQ <path>" / "END <path> ok|aborted"
line per request to $RUN_DIR/http.log.
"""
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RUN_DIR = os.environ["RUN_DIR"]
COVERS = os.path.join(RUN_DIR, "covers")
LOG = os.path.join(RUN_DIR, "http.log")
DELAY_S = 3


def note(text):
    with open(LOG, "a") as f:
        f.write(text + "\n")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_HEAD(self):
        # GVfs asks for the size first (query_info), then GETs the body.
        self.do_GET(head=True)

    def do_GET(self, head=False):
        path = self.path.split("?")[0]
        note(f"{'HEAD' if head else 'REQ'} {path}")
        slow = path.startswith("/slow/")
        name = os.path.basename(path)
        file = os.path.join(COVERS, name)
        if path.startswith("/missing/") or not os.path.isfile(file):
            self.send_error(404)
            if not head:
                note(f"END {path} 404")
            return
        with open(file, "rb") as f:
            body = f.read()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if head:
                return
            if slow:
                half = len(body) // 2
                self.wfile.write(body[:half])
                self.wfile.flush()
                time.sleep(DELAY_S)
                self.wfile.write(body[half:])
            else:
                self.wfile.write(body)
            note(f"END {path} ok")
        except (BrokenPipeError, ConnectionResetError):
            note(f"END {path} aborted")


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(os.path.join(RUN_DIR, "http.port"), "w") as f:
    f.write(str(server.server_address[1]))
with open(os.path.join(RUN_DIR, "http.pid"), "w") as f:
    f.write(str(os.getpid()))
open(LOG, "a").close()
server.serve_forever()
