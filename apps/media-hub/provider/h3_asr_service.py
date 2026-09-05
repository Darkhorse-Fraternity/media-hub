#!/usr/bin/env python3
"""Private, read-only ASR service for validating H3's original soundtrack."""

from __future__ import annotations

import argparse
import base64
import binascii
import hmac
import json
import tempfile
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from faster_whisper import WhisperModel


class AsrRuntime:
    def __init__(
        self,
        model_name: str,
        device: str,
        compute_type: str,
        cpu_threads: int,
        download_root: str | None,
    ) -> None:
        self.model_name = model_name
        self.device = device
        self.model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
            download_root=download_root,
        )
        self.lock = threading.Lock()

    def transcribe(self, media_path: str, language: str | None) -> dict[str, Any]:
        with self.lock:
            segments, info = self.model.transcribe(
                media_path,
                language=language,
                task="transcribe",
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            rows = [
                {"start": segment.start, "end": segment.end, "text": segment.text.strip()}
                for segment in segments
            ]
        return {
            "text": "".join(row["text"] for row in rows).strip(),
            "segments": rows,
            "language": info.language,
            "language_probability": info.language_probability,
            "model": self.model_name,
        }


def create_server(
    host: str,
    port: int,
    runtime: AsrRuntime,
    token: str,
    max_media_bytes: int,
) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        server_version = "media-hub-h3-asr/1.0"

        def write_json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def authorized(self) -> bool:
            if not token:
                return True
            header = self.headers.get("Authorization", "")
            supplied = header[7:] if header.lower().startswith("bearer ") else ""
            return hmac.compare_digest(supplied, token)

        def do_GET(self) -> None:  # noqa: N802
            if self.path != "/healthz":
                self.write_json({"message": "not found"}, HTTPStatus.NOT_FOUND)
                return
            self.write_json(
                {
                    "status": "healthy",
                    "model": runtime.model_name,
                    "device": runtime.device,
                }
            )

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/v1/transcriptions":
                self.write_json({"message": "not found"}, HTTPStatus.NOT_FOUND)
                return
            if not self.authorized():
                self.write_json({"message": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
                return
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length <= 0 or content_length > max_media_bytes * 2:
                    raise ValueError("request body is empty or too large")
                payload = json.loads(self.rfile.read(content_length))
                encoded = payload.get("content_base64")
                if not isinstance(encoded, str):
                    raise ValueError("content_base64 is required")
                media = base64.b64decode(encoded, validate=True)
                if not media or len(media) > max_media_bytes:
                    raise ValueError("media is empty or too large")
                language = payload.get("language")
                if language not in (None, "zh", "en"):
                    raise ValueError("language must be zh or en")
                with tempfile.NamedTemporaryFile(suffix=".mp4") as source:
                    source.write(media)
                    source.flush()
                    result = runtime.transcribe(source.name, language)
                self.write_json(result)
            except (ValueError, json.JSONDecodeError, binascii.Error) as error:
                self.write_json({"message": str(error)}, HTTPStatus.BAD_REQUEST)
            except Exception as error:  # keep the private daemon alive
                self.write_json({"message": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

        def log_message(self, format: str, *args: Any) -> None:
            return

    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8788)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--cpu-threads", type=int, default=12)
    parser.add_argument("--download-root")
    parser.add_argument("--token-file")
    parser.add_argument("--max-media-bytes", type=int, default=80_000_000)
    args = parser.parse_args()
    token = Path(args.token_file).read_text().strip() if args.token_file else ""
    runtime = AsrRuntime(
        args.model,
        args.device,
        args.compute_type,
        args.cpu_threads,
        args.download_root,
    )
    server = create_server(args.host, args.port, runtime, token, args.max_media_bytes)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
