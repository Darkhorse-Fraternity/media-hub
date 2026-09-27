#!/usr/bin/env python3
"""Authenticated client for this project's Media Hub Agent API."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
from pathlib import Path
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "https://media-hub.test-xm.pumpkii.click:8880"
KEYCHAIN_SERVICE = "media-hub-agent-api"
KEYCHAIN_ACCOUNT = "media-hub-agent"


def token() -> str:
    value = os.environ.get("MEDIA_HUB_AGENT_TOKEN", "").strip()
    if value:
        return value
    if sys.platform == "darwin":
        result = subprocess.run(
            ["security", "find-generic-password", "-a", KEYCHAIN_ACCOUNT,
             "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    raise RuntimeError(
        "No Agent API token available. Set MEDIA_HUB_AGENT_TOKEN or add the "
        "media-hub-agent-api item to macOS Keychain."
    )


def base_url() -> str:
    return os.environ.get("MEDIA_HUB_AGENT_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def request(method: str, path: str, payload: dict | None = None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {token()}",
        "User-Agent": "codex-media-hub-video/1",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = Request(base_url() + path, data=body, headers=headers, method=method)
    try:
        return urlopen(req, timeout=60)
    except HTTPError as exc:
        detail = exc.read(8192).decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from None
    except URLError as exc:
        raise RuntimeError(f"Agent API connection failed: {exc.reason}") from None


def request_json(method: str, path: str, payload: dict | None = None):
    with request(method, path, payload) as response:
        return json.load(response)


def read_payload(path: str) -> dict:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Payload file must contain a JSON object")
    return value


def upload_image(path: str):
    image_path = Path(path)
    data = image_path.read_bytes()
    if not 0 < len(data) <= 5_000_000:
        raise ValueError("Image must be between 1 byte and 5 MB")
    content_type = mimetypes.guess_type(image_path.name)[0]
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError("Image must be JPEG, PNG, or WebP")
    return request_json(
        "POST",
        "/api/v1/uploads/presign",
        {
            "filename": image_path.name,
            "content_type": content_type,
            "size_bytes": len(data),
            "content_base64": base64.b64encode(data).decode("ascii"),
        },
    )


def download_video(job_id: str, output: str) -> dict:
    output_path = Path(output)
    part_path = output_path.with_name(output_path.name + ".part")
    path = f"/api/v1/generations/{quote(job_id, safe='')}/video"
    try:
        with request("GET", path) as response, part_path.open("wb") as target:
            while chunk := response.read(1024 * 1024):
                target.write(chunk)
        part_path.replace(output_path)
    except Exception:
        part_path.unlink(missing_ok=True)
        raise
    return {
        "job_id": job_id,
        "path": str(output_path.resolve()),
        "bytes": output_path.stat().st_size,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("profiles", help="List available generation profiles")
    jobs = commands.add_parser("jobs", help="List generation jobs")
    jobs.add_argument("--status", choices=["scheduled", "queued", "waiting_for_gpu", "running", "succeeded", "failed", "canceled"])
    jobs.add_argument("--whole-videos-only", action="store_true", help="Exclude individual script-shot jobs")
    jobs.add_argument("--page", type=int, default=1)
    jobs.add_argument("--page-size", type=int, default=20)
    scripts = commands.add_parser("scripts", help="List structured video scripts")
    scripts.add_argument("--page", type=int, default=1)
    scripts.add_argument("--page-size", type=int, default=30)
    for name in ("job", "retry"):
        command = commands.add_parser(name)
        command.add_argument("job_id")
    for name in ("script", "assemble"):
        command = commands.add_parser(name)
        command.add_argument("script_id")
        if name == "assemble":
            command.add_argument("--source-job-id", action="append", dest="source_job_ids")
            command.add_argument("--transition", choices=["cut", "fade_white", "fade_black"])
            command.add_argument("--rebuild", action="store_true")
    for name in ("optimize", "generate"):
        command = commands.add_parser(name)
        command.add_argument("payload", help="Path to a JSON object")
    create_script = commands.add_parser("create-script", help="Create a structured multi-shot video script")
    create_script.add_argument("payload", help="Path to a JSON object")
    generate_shots = commands.add_parser("generate-shots", help="Queue H3 jobs for a script's shots")
    generate_shots.add_argument("script_id")
    generate_shots.add_argument("payload", help="Path to a JSON object, such as {}")
    edit = commands.add_parser("edit", help="Create a Ref2VA edit of a succeeded video")
    edit.add_argument("source_job_id")
    edit.add_argument("payload", help="Path to a JSON object")
    upload = commands.add_parser("upload", help="Upload a JPEG, PNG, or WebP first frame/reference")
    upload.add_argument("image")
    video = commands.add_parser("video", help="Download a succeeded job's MP4")
    video.add_argument("job_id")
    video.add_argument("output")
    args = parser.parse_args()

    if args.command == "profiles":
        result = request_json("GET", "/api/v1/generation-profiles")
    elif args.command == "jobs":
        query = urlencode({k: v for k, v in {
            "status": args.status, "page": args.page, "page_size": args.page_size,
            "whole_videos_only": "true" if args.whole_videos_only else None,
        }.items() if v is not None})
        result = request_json("GET", "/api/v1/generations?" + query)
    elif args.command == "scripts":
        query = urlencode({"page": args.page, "page_size": args.page_size})
        result = request_json("GET", "/api/v1/scripts?" + query)
    elif args.command == "script":
        result = request_json("GET", f"/api/v1/scripts/{quote(args.script_id, safe='')}")
    elif args.command == "assemble":
        payload = {
            "source_job_ids": args.source_job_ids,
            "transition": args.transition,
            "rebuild": args.rebuild if args.rebuild else None,
        }
        payload = {key: value for key, value in payload.items() if value is not None} or None
        result = request_json("POST", f"/api/v1/scripts/{quote(args.script_id, safe='')}/assemble", payload)
    elif args.command == "job":
        result = request_json("GET", f"/api/v1/generations/{quote(args.job_id, safe='')}")
    elif args.command == "retry":
        result = request_json("POST", f"/api/v1/generations/{quote(args.job_id, safe='')}/retry")
    elif args.command == "optimize":
        result = request_json("POST", "/api/v1/prompts/optimize", read_payload(args.payload))
    elif args.command == "generate":
        result = request_json("POST", "/api/v1/generations", read_payload(args.payload))
    elif args.command == "create-script":
        result = request_json("POST", "/api/v1/scripts", read_payload(args.payload))
    elif args.command == "generate-shots":
        result = request_json("POST", f"/api/v1/scripts/{quote(args.script_id, safe='')}/generate", read_payload(args.payload))
    elif args.command == "edit":
        result = request_json("POST", f"/api/v1/generations/{quote(args.source_job_id, safe='')}/edits", read_payload(args.payload))
    elif args.command == "upload":
        result = upload_image(args.image)
    else:
        result = download_video(args.job_id, args.output)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
