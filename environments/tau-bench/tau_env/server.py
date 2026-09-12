#!/usr/bin/env python3
"""tau-bench 上游环境 HTTP 服务（仅标准库；DSH 工具适配层通过 HTTP 调用）。

协议（JSON）：
  GET  /health                    -> {"ok": true, "cases": [...]}
  POST /cases/new                 {"case_id": "tau-bench-airline-000"}
                                  -> {"ok": true, "case_id": ...}
  POST /cases/<id>/execute        {"action": {"name": "book_reservation", "kwargs": {...}}}
                                  -> {"result": "..."}

环境变量：
  TAU_ENV_PORT         监听端口（默认 8788）
  DSHEVAL_DATASETS_ROOT 数据集根目录（默认 <repo>/datasets）
  TAU_DATA_DIR         数据目录（默认 <repo>/environments/tau-bench/data）
"""

import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tau_env.controller import CaseController  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATASETS_ROOT = os.environ.get("DSHEVAL_DATASETS_ROOT", os.path.join(REPO_ROOT, "datasets"))
DATA_DIR = os.environ.get(
    "TAU_DATA_DIR", os.path.join(REPO_ROOT, "environments", "tau-bench", "data")
)

_CONTROLLERS = {}


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "cases": sorted(_CONTROLLERS)})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception as error:  # noqa: BLE001
            self._json(400, {"error": f"bad request: {error}"})
            return
        if path == "/cases/new":
            case_id = payload.get("case_id")
            if not case_id:
                self._json(400, {"error": "case_id required"})
                return
            case_dir = payload.get("case_dir") or os.path.join(DATASETS_ROOT, "tau-bench", case_id)
            try:
                _CONTROLLERS[case_id] = CaseController(case_dir, DATA_DIR)
            except Exception as error:  # noqa: BLE001
                self._json(400, {"error": f"cannot load case {case_id}: {error}"})
                return
            self._json(200, {"ok": True, "case_id": case_id})
            return
        match = re.match(r"^/cases/([^/]+)/execute$", path)
        if match:
            case_id = match.group(1)
            controller = _CONTROLLERS.get(case_id)
            if controller is None:
                self._json(404, {"error": f"case {case_id} not loaded"})
                return
            action = payload.get("action", {})
            try:
                result = controller.execute(action)
            except Exception as error:  # noqa: BLE001
                result = f"Error during execution: {error}"
            self._json(200, {"result": result})
            return
        self._json(404, {"error": "unknown endpoint"})


def main():
    port = int(os.environ.get("TAU_ENV_PORT", "8788"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"tau-bench env listening on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
