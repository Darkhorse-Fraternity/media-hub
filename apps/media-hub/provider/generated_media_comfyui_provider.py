from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request as FastApiRequest


LOGGER = logging.getLogger("ydc.generated-media-provider")
REQUEST_CONTRACT = "ydc_generated_media_provider_request.v1"
CONFIG_CONTRACT = "generated_media_provider_config.v1"
COMFYUI_WAN22_ADAPTER_KIND = "comfyui_wan22_i2v.v1"
COMFYUI_H3_ADAPTER_KIND = "comfyui_minimax_h3_i2v.v1"
COMFYUI_H3_OFFICIAL_I2V_ADAPTER_KIND = "comfyui_minimax_h3_i2v_official.v1"
COMFYUI_H3_REF2VA_ADAPTER_KIND = "comfyui_minimax_h3_ref2va.v1"
COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND = "comfyui_hidream_o1_image.v1"
INLINE_CORE_H3_ADAPTER_KIND = "inline_core_minimax_h3_i2v.v1"
# Backward-compatible export used by existing callers and tests.
ADAPTER_KIND = COMFYUI_WAN22_ADAPTER_KIND
INLINE_CORE_H3_NODE_TYPE = "minimax/h3-image-to-video"
SAMPLE_CONTRACT = "generated_video_sample.v1"
IMAGE_SAMPLE_CONTRACT = "generated_image_sample.v1"
ACTIVE_JOB_STATUSES = {"queued", "running", "canceling"}
REQUIRED_NODES = (
    "UNETLoader",
    "LoraLoaderModelOnly",
    "ModelSamplingSD3",
    "CLIPLoader",
    "VAELoader",
    "LoadImage",
    "CLIPTextEncode",
    "WanImageToVideo",
    "KSamplerAdvanced",
    "VAEDecode",
    "CreateVideo",
    "SaveVideo",
)
H3_REQUIRED_NODES = (
    "UNETLoader",
    "MiniMaxH3TurboLoRA",
    "CLIPLoader",
    "VAELoader",
    "LoadImage",
    "MiniMaxH3ImageToVideo",
    "MiniMaxH3ReferenceToVideo",
    "YDCMiniMaxH3MultiReferenceToVideo",
    "LoadVideo",
    "GetVideoComponents",
    "RandomNoise",
    "BasicScheduler",
    "KSamplerSelect",
    "MiniMaxH3SigmaShift",
    "MiniMaxH3TurboSampler",
    "BasicGuider",
    "SamplerCustomAdvanced",
    "VAEDecode",
    "VAEDecodeAudio",
    "CreateVideo",
    "SaveVideo",
)
HIDREAM_IMAGE_REQUIRED_NODES = (
    "CheckpointLoaderSimple",
    "CLIPTextEncode",
    "ModelNoiseScale",
    "HiDreamO1PatchSeamSmoothing",
    "EmptyHiDreamO1LatentImage",
    "HiDreamO1ReferenceImages",
    "LoadImage",
    "BasicScheduler",
    "KSamplerSelect",
    "SamplerCustom",
    "VAEDecode",
    "SaveImage",
)
COMFYUI_H3_ADAPTER_KINDS = {
    COMFYUI_H3_ADAPTER_KIND,
    COMFYUI_H3_OFFICIAL_I2V_ADAPTER_KIND,
    COMFYUI_H3_REF2VA_ADAPTER_KIND,
}
H3_ADAPTER_KINDS = {*COMFYUI_H3_ADAPTER_KINDS, INLINE_CORE_H3_ADAPTER_KIND}
ALLOWED_PARAMETERS = {
    "behavior_prompts",
    "negative_prompt",
    "width",
    "height",
    "length",
    "duration_frames",
    "fps",
    "steps",
    "cfg",
    "seed",
    "preserve_source_audio",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _checksum(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def _required_string(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ProviderJobError("invalid_request", f"{field} is required")
    return text


def _bounded_int(value: Any, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise ProviderJobError("invalid_generation_spec", f"{field} is invalid")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ProviderJobError("invalid_generation_spec", f"{field} is invalid") from exc
    if not minimum <= parsed <= maximum:
        raise ProviderJobError("invalid_generation_spec", f"{field} is outside platform limits")
    return parsed


def _bounded_float(value: Any, field: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool):
        raise ProviderJobError("invalid_generation_spec", f"{field} is invalid")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ProviderJobError("invalid_generation_spec", f"{field} is invalid") from exc
    if not minimum <= parsed <= maximum:
        raise ProviderJobError("invalid_generation_spec", f"{field} is outside platform limits")
    return parsed


class ProviderJobError(RuntimeError):
    def __init__(
        self,
        code: str,
        safe_message: str,
        *,
        failure_stage: str | None = None,
        retryable: bool | None = None,
    ) -> None:
        super().__init__(safe_message)
        self.code = code
        self.safe_message = safe_message
        default_stage, default_retryable = _provider_failure_defaults(code)
        self.failure_stage = failure_stage or default_stage
        self.retryable = default_retryable if retryable is None else retryable


def _provider_failure_defaults(code: str) -> tuple[str, bool]:
    if code in {"comfyui_unavailable", "comfyui_invalid_response", "comfyui_timeout"}:
        return "provider_backend", True
    if code in {"comfyui_execution_failed", "comfyui_output_missing", "provider_output_missing"}:
        return "provider_execution", True
    if code == "provider_internal_error":
        return "provider_execution", True
    if code.startswith("provider_output_"):
        return "output_validation", False
    if code.startswith("comfyui_"):
        return "provider_configuration", False
    if code in {
        "inline_core_unavailable",
        "inline_core_invalid_response",
        "inline_core_timeout",
        "inline_core_unload_failed",
    }:
        return "provider_backend", True
    if code in {
        "inline_core_execution_failed",
        "inline_core_output_missing",
        "inline_core_canceled",
    }:
        return "provider_execution", True
    if code.startswith("inline_core_"):
        return "provider_configuration", False
    return "request_validation", False


class ProviderJobCanceled(RuntimeError):
    pass


@dataclass(frozen=True)
class ProviderProfile:
    name: str
    adapter: str
    workflow_version: str
    model_version: str
    unet_high: str
    unet_low: str
    lora_high: str
    lora_low: str
    clip: str
    vae: str
    default_behavior_prompts: dict[str, str]
    default_negative_prompt: str
    default_width: int
    default_height: int
    default_length: int
    default_fps: float
    default_steps: int
    default_cfg: float
    switch_step: int
    max_width: int
    max_height: int
    max_length: int
    transformer: str = ""
    text_encoder: str = ""
    video_vae: str = ""
    audio_vae: str = ""
    processor: str = ""
    turbo_lora: str = ""
    checkpoint: str = ""

    @classmethod
    def from_mapping(cls, name: str, value: Any) -> "ProviderProfile":
        if not isinstance(value, dict):
            raise RuntimeError(f"provider profile must be an object: {name}")
        models = value.get("models")
        defaults = value.get("defaults")
        limits = value.get("limits")
        if not isinstance(models, dict) or not isinstance(defaults, dict):
            raise RuntimeError(f"provider profile models/defaults are required: {name}")
        if not isinstance(limits, dict):
            limits = {}
        raw_behavior_prompts = defaults.get("behavior_prompts") or {}
        if not isinstance(raw_behavior_prompts, dict):
            raise RuntimeError(
                f"provider profile defaults.behavior_prompts must be an object: {name}"
            )
        default_behavior_prompts: dict[str, str] = {}
        for label, prompt in raw_behavior_prompts.items():
            normalized_label = str(label).strip()
            normalized_prompt = str(prompt).strip()
            if not normalized_label or not normalized_prompt:
                raise RuntimeError(
                    f"provider profile defaults.behavior_prompts must contain non-empty strings: {name}"
                )
            default_behavior_prompts[normalized_label] = normalized_prompt
        adapter = str(value.get("adapter") or "")
        if adapter not in {
            COMFYUI_WAN22_ADAPTER_KIND,
            COMFYUI_H3_ADAPTER_KIND,
            COMFYUI_H3_OFFICIAL_I2V_ADAPTER_KIND,
            COMFYUI_H3_REF2VA_ADAPTER_KIND,
            COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND,
            INLINE_CORE_H3_ADAPTER_KIND,
        }:
            raise RuntimeError(f"unsupported generated-media adapter: {adapter}")

        def model_value(key: str) -> str:
            return str(models.get(key) or "").strip()

        if adapter == COMFYUI_WAN22_ADAPTER_KIND:
            required_model_keys = (
                "unet_high", "unet_low", "lora_high", "lora_low", "clip", "vae"
            )
        elif adapter == COMFYUI_H3_ADAPTER_KIND:
            required_model_keys = (
                "transformer", "text_encoder", "video_vae", "audio_vae", "turbo_lora"
            )
        elif adapter == COMFYUI_H3_OFFICIAL_I2V_ADAPTER_KIND:
            required_model_keys = (
                "transformer", "text_encoder", "video_vae", "audio_vae"
            )
        elif adapter == COMFYUI_H3_REF2VA_ADAPTER_KIND:
            required_model_keys = (
                "transformer", "text_encoder", "video_vae", "audio_vae"
            )
        elif adapter == INLINE_CORE_H3_ADAPTER_KIND:
            required_model_keys = (
                "transformer", "text_encoder", "video_vae", "audio_vae", "processor"
            )
        else:
            required_model_keys = ("checkpoint",)
        for key in required_model_keys:
            _required_config_string(models, key, name)
        return cls(
            name=name,
            adapter=adapter,
            workflow_version=str(value.get("workflow_version") or adapter),
            model_version=str(value.get("model_version") or "platform-managed"),
            unet_high=model_value("unet_high"),
            unet_low=model_value("unet_low"),
            lora_high=model_value("lora_high"),
            lora_low=model_value("lora_low"),
            clip=model_value("clip"),
            vae=model_value("vae"),
            default_behavior_prompts=default_behavior_prompts,
            default_negative_prompt=str(defaults.get("negative_prompt") or ""),
            default_width=int(defaults.get("width", 640)),
            default_height=int(defaults.get("height", 384)),
            default_length=int(defaults.get("length", 81)),
            default_fps=float(defaults.get("fps", 16)),
            default_steps=int(defaults.get("steps", 4)),
            default_cfg=float(defaults.get("cfg", 1)),
            switch_step=int(defaults.get("switch_step", 2)),
            max_width=int(limits.get("max_width", 1280)),
            max_height=int(limits.get("max_height", 1280)),
            max_length=int(limits.get("max_length", 161)),
            transformer=model_value("transformer"),
            text_encoder=model_value("text_encoder"),
            video_vae=model_value("video_vae"),
            audio_vae=model_value("audio_vae"),
            processor=model_value("processor"),
            turbo_lora=model_value("turbo_lora"),
            checkpoint=model_value("checkpoint"),
        )

    @property
    def configured_models(self) -> dict[str, tuple[str, ...]]:
        if self.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND:
            return {"CheckpointLoaderSimple": (self.checkpoint,)}
        if self.adapter in COMFYUI_H3_ADAPTER_KINDS:
            models = {
                "UNETLoader": (self.transformer,),
                "CLIPLoader": (self.text_encoder,),
                "VAELoader": (self.video_vae, self.audio_vae),
            }
            if self.adapter == COMFYUI_H3_ADAPTER_KIND:
                models["MiniMaxH3TurboLoRA"] = (self.turbo_lora,)
            return models
        return {
            "UNETLoader": (self.unet_high, self.unet_low),
            "LoraLoaderModelOnly": (self.lora_high, self.lora_low),
            "CLIPLoader": (self.clip,),
            "VAELoader": (self.vae,),
        }


def _required_config_string(value: dict[str, Any], key: str, profile: str) -> str:
    text = str(value.get(key) or "").strip()
    if not text:
        raise RuntimeError(f"provider profile model is required: {profile}.{key}")
    return text


def _available_ram_gb() -> float | None:
    """Return Linux MemAvailable without adding a provider dependency."""
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) / (1024 * 1024)
    except (OSError, ValueError, IndexError):
        return None
    return None


@dataclass(frozen=True)
class ProviderConfig:
    comfyui_url: str
    state_root: Path
    token_file: Path
    provider_version: str
    profiles: dict[str, ProviderProfile]
    inline_core_url: str = ""
    max_source_bytes: int = 256 * 1024 * 1024
    max_outputs: int = 16
    poll_seconds: float = 2.0
    job_timeout_seconds: float = 1800.0
    inline_core_idle_unload_seconds: float = 3600.0
    inline_core_memory_pressure_unload_gb: float = 12.0
    inline_core_memory_pressure_min_idle_seconds: float = 300.0
    inline_core_memory_pressure_check_seconds: float = 60.0
    inline_core_service_unit: str = "ydc-inline-core-h3.service"

    @classmethod
    def from_environment(cls) -> "ProviderConfig":
        raw_config_path = os.environ.get("YDC_GENERATED_MEDIA_PROVIDER_CONFIG", "").strip()
        if not raw_config_path:
            raise RuntimeError("YDC_GENERATED_MEDIA_PROVIDER_CONFIG is required")
        config_path = Path(raw_config_path)
        raw = json.loads(config_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or raw.get("schema_version") != CONFIG_CONTRACT:
            raise RuntimeError(f"provider configuration must use {CONFIG_CONTRACT}")
        raw_profiles = raw.get("profiles")
        if not isinstance(raw_profiles, dict) or not raw_profiles:
            raise RuntimeError("provider configuration profiles are required")
        profiles = {
            str(name): ProviderProfile.from_mapping(str(name), value)
            for name, value in raw_profiles.items()
        }
        comfyui_url = os.environ.get("YDC_GENERATED_MEDIA_COMFYUI_URL", "").strip().rstrip("/")
        inline_core_url = os.environ.get(
            "YDC_GENERATED_MEDIA_INLINE_CORE_URL", "http://127.0.0.1:8848"
        ).strip().rstrip("/")
        if any(
            profile.adapter in {
                COMFYUI_WAN22_ADAPTER_KIND,
                COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND,
                *COMFYUI_H3_ADAPTER_KINDS,
            }
            for profile in profiles.values()
        ) and not comfyui_url.startswith(("http://", "https://")):
            raise RuntimeError("YDC_GENERATED_MEDIA_COMFYUI_URL is required")
        if any(
            profile.adapter == INLINE_CORE_H3_ADAPTER_KIND for profile in profiles.values()
        ) and not inline_core_url.startswith(("http://", "https://")):
            raise RuntimeError("YDC_GENERATED_MEDIA_INLINE_CORE_URL is required")
        raw_token_file = os.environ.get(
            "YDC_GENERATED_MEDIA_PROVIDER_TOKEN_FILE", ""
        ).strip()
        if not raw_token_file:
            raise RuntimeError("YDC_GENERATED_MEDIA_PROVIDER_TOKEN_FILE is required")
        token_file = Path(raw_token_file)
        idle_unload_seconds = float(raw.get("inline_core_idle_unload_seconds", 3600))
        if not 0 <= idle_unload_seconds <= 86400:
            raise RuntimeError("inline_core_idle_unload_seconds must be between 0 and 86400")
        pressure_unload_gb = float(raw.get("inline_core_memory_pressure_unload_gb", 12))
        if not 0 <= pressure_unload_gb <= 1024:
            raise RuntimeError(
                "inline_core_memory_pressure_unload_gb must be between 0 and 1024"
            )
        pressure_min_idle_seconds = float(
            raw.get("inline_core_memory_pressure_min_idle_seconds", 300)
        )
        if not 0 <= pressure_min_idle_seconds <= 86400:
            raise RuntimeError(
                "inline_core_memory_pressure_min_idle_seconds must be between 0 and 86400"
            )
        pressure_check_seconds = float(
            raw.get("inline_core_memory_pressure_check_seconds", 60)
        )
        if not 5 <= pressure_check_seconds <= 3600:
            raise RuntimeError(
                "inline_core_memory_pressure_check_seconds must be between 5 and 3600"
            )
        inline_core_service_unit = str(
            raw.get("inline_core_service_unit") or "ydc-inline-core-h3.service"
        ).strip()
        if not re.fullmatch(r"[A-Za-z0-9_.@-]+\.service", inline_core_service_unit):
            raise RuntimeError("inline_core_service_unit is invalid")
        return cls(
            comfyui_url=comfyui_url,
            state_root=Path(
                os.environ.get(
                    "YDC_GENERATED_MEDIA_PROVIDER_STATE_ROOT",
                    "./data/generated-media-provider",
                )
            ),
            token_file=token_file,
            provider_version=str(raw.get("provider_version") or "1.0"),
            profiles=profiles,
            inline_core_url=inline_core_url,
            max_source_bytes=int(raw.get("max_source_bytes", 256 * 1024 * 1024)),
            max_outputs=int(raw.get("max_outputs", 16)),
            poll_seconds=float(raw.get("poll_seconds", 2)),
            job_timeout_seconds=float(raw.get("job_timeout_seconds", 1800)),
            inline_core_idle_unload_seconds=idle_unload_seconds,
            inline_core_memory_pressure_unload_gb=pressure_unload_gb,
            inline_core_memory_pressure_min_idle_seconds=pressure_min_idle_seconds,
            inline_core_memory_pressure_check_seconds=pressure_check_seconds,
            inline_core_service_unit=inline_core_service_unit,
        )

    def token(self) -> str:
        try:
            token = self.token_file.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise RuntimeError("provider credential is not readable") from exc
        if not token:
            raise RuntimeError("provider credential is empty")
        return token


class ComfyUiClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
        timeout: float = 60,
    ) -> bytes:
        request = Request(
            self.base_url + path,
            method=method,
            data=body,
            headers=headers or {},
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            raise ProviderJobError(
                "comfyui_unavailable",
                "platform generation backend is unavailable",
            ) from exc

    def _json(self, method: str, path: str, payload: Any | None = None) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        raw = self._request(
            method,
            path,
            body=body,
            headers={"content-type": "application/json"} if body is not None else None,
        )
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderJobError(
                "comfyui_invalid_response",
                "platform generation backend returned an invalid response",
            ) from exc
        if not isinstance(value, dict):
            raise ProviderJobError(
                "comfyui_invalid_response",
                "platform generation backend returned an invalid response",
            )
        return value

    def healthcheck(self, profiles: dict[str, ProviderProfile]) -> dict[str, Any]:
        self._json("GET", "/system_stats")
        node_payloads: dict[str, str] = {}
        for node_name in REQUIRED_NODES:
            value = self._json("GET", f"/object_info/{quote(node_name, safe='')}")
            if node_name not in value:
                raise ProviderJobError(
                    "comfyui_node_missing",
                    "platform generation workflow is not available",
                )
            node_payloads[node_name] = json.dumps(value, separators=(",", ":"))
        for profile in profiles.values():
            for node_name, models in profile.configured_models.items():
                payload = node_payloads[node_name]
                if any(model not in payload for model in models):
                    raise ProviderJobError(
                        "comfyui_model_missing",
                        "platform generation model is not available",
                    )
        return {
            "status": "healthy",
            "profiles": sorted(profiles),
            "nodes_verified": len(REQUIRED_NODES),
        }

    def healthcheck_h3(self, profiles: dict[str, ProviderProfile]) -> dict[str, Any]:
        self._json("GET", "/system_stats")
        node_payloads: dict[str, str] = {}
        for node_name in H3_REQUIRED_NODES:
            value = self._json("GET", f"/object_info/{quote(node_name, safe='')}")
            if node_name not in value:
                raise ProviderJobError(
                    "comfyui_node_missing",
                    "platform H3 generation workflow is not available",
                )
            node_payloads[node_name] = json.dumps(value, separators=(",", ":"))
        for profile in profiles.values():
            for node_name, models in profile.configured_models.items():
                payload = node_payloads[node_name]
                if any(model not in payload for model in models):
                    raise ProviderJobError(
                        "comfyui_model_missing",
                        "platform H3 generation model is not available",
                    )
        return {
            "status": "healthy",
            "profiles": sorted(profiles),
            "nodes_verified": len(H3_REQUIRED_NODES),
            "backend": "comfyui_h3",
        }

    def healthcheck_hidream_image(
        self, profiles: dict[str, ProviderProfile]
    ) -> dict[str, Any]:
        self._json("GET", "/system_stats")
        node_payloads: dict[str, str] = {}
        for node_name in HIDREAM_IMAGE_REQUIRED_NODES:
            value = self._json("GET", f"/object_info/{quote(node_name, safe='')}")
            if node_name not in value:
                raise ProviderJobError(
                    "comfyui_node_missing",
                    "platform HiDream image workflow is not available",
                )
            node_payloads[node_name] = json.dumps(value, separators=(",", ":"))
        for profile in profiles.values():
            for node_name, models in profile.configured_models.items():
                payload = node_payloads[node_name]
                if any(model not in payload for model in models):
                    raise ProviderJobError(
                        "comfyui_model_missing",
                        "platform HiDream image model is not available",
                    )
        return {
            "status": "healthy",
            "profiles": sorted(profiles),
            "nodes_verified": len(HIDREAM_IMAGE_REQUIRED_NODES),
            "backend": "comfyui_hidream_o1",
            "capabilities": {
                "modes": ["text_to_image", "reference_edit"],
                "max_reference_images": 4,
                "content_types": ["image/png"],
            },
        }

    def upload_input(self, content: bytes, filename: str, subfolder: str) -> str:
        boundary = uuid4().hex
        body = bytearray()
        parts = (
            ("image", filename, content, "application/octet-stream"),
            ("subfolder", None, subfolder.encode(), None),
            ("type", None, b"input", None),
            ("overwrite", None, b"true", None),
        )
        for name, part_filename, part_content, content_type in parts:
            body += f"--{boundary}\r\n".encode()
            if part_filename:
                body += (
                    f'Content-Disposition: form-data; name="{name}"; '
                    f'filename="{part_filename}"\r\n'
                ).encode()
                body += f"Content-Type: {content_type}\r\n\r\n".encode()
            else:
                body += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
            body += part_content
            body += b"\r\n"
        body += f"--{boundary}--\r\n".encode()
        value = json.loads(
            self._request(
                "POST",
                "/upload/image",
                body=bytes(body),
                headers={"content-type": f"multipart/form-data; boundary={boundary}"},
            )
        )
        name = _required_string(value.get("name"), "uploaded image name")
        returned_subfolder = str(value.get("subfolder") or "")
        return f"{returned_subfolder}/{name}" if returned_subfolder else name

    def upload_image(self, content: bytes, filename: str, subfolder: str) -> str:
        return self.upload_input(content, filename, subfolder)

    def free_memory(self) -> None:
        self._request(
            "POST",
            "/free",
            body=json.dumps(
                {"unload_models": True, "free_memory": True},
                separators=(",", ":"),
            ).encode(),
            headers={"content-type": "application/json"},
        )

    def queue_prompt(self, prompt: dict[str, Any], client_id: str) -> str:
        value = self._json("POST", "/prompt", {"prompt": prompt, "client_id": client_id})
        return _required_string(value.get("prompt_id"), "ComfyUI prompt_id")

    def prompt_exists(self, prompt_id: str) -> bool:
        history = self._json("GET", f"/history/{quote(prompt_id, safe='')}")
        if isinstance(history.get(prompt_id), dict):
            return True
        queue = self._json("GET", "/queue")
        for queue_name in ("queue_running", "queue_pending"):
            entries = queue.get(queue_name)
            if not isinstance(entries, list):
                continue
            if any(
                isinstance(entry, list)
                and len(entry) > 1
                and str(entry[1]) == prompt_id
                for entry in entries
            ):
                return True
        return False

    def wait_for_history(
        self,
        prompt_id: str,
        *,
        timeout: float,
        poll_seconds: float,
        canceled: Callable[[], bool],
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if canceled():
                raise ProviderJobCanceled("provider job canceled")
            value = self._json("GET", f"/history/{quote(prompt_id, safe='')}")
            history = value.get(prompt_id)
            if isinstance(history, dict):
                status = history.get("status")
                if isinstance(status, dict) and (
                    status.get("status_str") == "error"
                    or status.get("completed") is False
                ):
                    raise ProviderJobError(
                        "comfyui_execution_failed",
                        "platform generation workflow failed",
                    )
                return history
            time.sleep(poll_seconds)
        raise ProviderJobError(
            "comfyui_timeout",
            "platform generation workflow timed out",
        )

    def download_output(self, history: dict[str, Any], save_node_id: str = "70") -> bytes:
        outputs = history.get("outputs")
        node_output = outputs.get(save_node_id) if isinstance(outputs, dict) else None
        descriptor = _find_output_descriptor(node_output)
        if descriptor is None:
            raise ProviderJobError(
                "comfyui_output_missing",
                "platform generation workflow returned no output",
            )
        query = urlencode(
            {
                "filename": descriptor["filename"],
                "subfolder": descriptor.get("subfolder") or "",
                "type": descriptor.get("type") or "output",
            }
        )
        content = self._request("GET", f"/view?{query}", timeout=120)
        if not content:
            raise ProviderJobError(
                "comfyui_output_missing",
                "platform generation workflow returned an empty output",
            )
        return content

    def interrupt(self) -> None:
        try:
            self._json("POST", "/interrupt", {})
        except ProviderJobError:
            LOGGER.warning("ComfyUI interrupt request failed")



class InlineCoreClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def _request(
        self,
        method: str,
        path: str,
        *,
        payload: Any | None = None,
        timeout: float = 60,
    ) -> bytes:
        body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        request = Request(
            self.base_url + path,
            method=method,
            data=body,
            headers={"content-type": "application/json"} if body is not None else {},
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            raise ProviderJobError(
                "inline_core_unavailable",
                "platform H3 generation backend is unavailable",
            ) from exc

    def _json(self, method: str, path: str, payload: Any | None = None) -> dict[str, Any]:
        raw = self._request(method, path, payload=payload)
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderJobError(
                "inline_core_invalid_response",
                "platform H3 generation backend returned an invalid response",
            ) from exc
        if not isinstance(value, dict):
            raise ProviderJobError(
                "inline_core_invalid_response",
                "platform H3 generation backend returned an invalid response",
            )
        return value

    def healthcheck(self, profiles: dict[str, ProviderProfile]) -> dict[str, Any]:
        health = self._json("GET", "/v1/health")
        if health.get("ok") is not True:
            raise ProviderJobError(
                "inline_core_unavailable",
                "platform H3 generation backend is unavailable",
            )
        descriptor = self._json("GET", f"/v1/models/{INLINE_CORE_H3_NODE_TYPE}")
        if descriptor.get("type") != INLINE_CORE_H3_NODE_TYPE:
            raise ProviderJobError(
                "inline_core_node_missing",
                "platform H3 generation workflow is not available",
            )
        params = {
            str(item.get("key")): item
            for item in descriptor.get("params") or []
            if isinstance(item, dict)
        }
        for profile in profiles.values():
            expected = {
                "model": profile.transformer,
                "text_encoder": profile.text_encoder,
                "vae": profile.video_vae,
            }
            for key, configured in expected.items():
                value = params.get(key)
                if not isinstance(value, dict) or value.get("default") != configured:
                    raise ProviderJobError(
                        "inline_core_model_missing",
                        "platform H3 generation model is not available",
                    )
        return {
            "status": "healthy",
            "profiles": sorted(profiles),
            "node_type": INLINE_CORE_H3_NODE_TYPE,
            "device": health.get("device"),
        }

    def queue_i2v(
        self,
        profile: ProviderProfile,
        *,
        image_path: Path,
        prompt: str,
        width: int,
        height: int,
        length: int,
        fps: float,
        steps: int,
        seed: int,
    ) -> str:
        graph = {
            "schemaVersion": 1,
            "nodes": [
                {"id": "prompt", "type": "input/text", "params": {"text": prompt}},
                {
                    "id": "source",
                    "type": "input/image",
                    "params": {"asset": {"ref": "path", "path": str(image_path)}},
                },
                {
                    "id": "h3",
                    "type": INLINE_CORE_H3_NODE_TYPE,
                    "params": {
                        "duration": max(5.0, min(15.0, length / fps)),
                        "width": width,
                        "height": height,
                        "num_inference_steps": steps,
                        "seed": seed,
                        "model": profile.transformer,
                        "text_encoder": profile.text_encoder,
                        "vae": profile.video_vae,
                    },
                    "inputs": {
                        "prompt": [{"from": "prompt", "output": "text"}],
                        "image": [{"from": "source", "output": "image"}],
                    },
                },
            ],
        }
        value = self._json("POST", "/v1/runs", {"graph": graph, "target": "h3"})
        return _required_string(value.get("runId"), "Inline Core runId")

    def wait_for_output(
        self,
        run_id: str,
        *,
        timeout: float,
        poll_seconds: float,
        canceled: Callable[[], bool],
    ) -> bytes:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if canceled():
                self.cancel(run_id)
                raise ProviderJobCanceled("provider job canceled")
            state = self._json("GET", f"/v1/runs/{quote(run_id, safe='')}")
            status = str(state.get("status") or "")
            if status == "done":
                takes = state.get("takes")
                if isinstance(takes, list):
                    for take in takes:
                        if not isinstance(take, dict) or take.get("kind") != "video":
                            continue
                        if take.get("nodeId", take.get("node_id")) != "h3":
                            continue
                        take_id = _required_string(take.get("id"), "Inline Core take id")
                        content = self._request(
                            "GET", f"/v1/takes/{quote(take_id, safe='')}/bytes", timeout=300
                        )
                        if content:
                            return content
                raise ProviderJobError(
                    "inline_core_output_missing",
                    "platform H3 generation workflow returned no video",
                )
            if status in {"failed", "error"}:
                raise ProviderJobError(
                    "inline_core_execution_failed",
                    "platform H3 generation workflow failed",
                )
            if status in {"canceled", "cancelled"}:
                raise ProviderJobError(
                    "inline_core_canceled",
                    "platform H3 generation workflow was canceled",
                )
            time.sleep(poll_seconds)
        self.cancel(run_id)
        raise ProviderJobError(
            "inline_core_timeout",
            "platform H3 generation workflow timed out",
        )

    def cancel(self, run_id: str) -> None:
        try:
            self._request("DELETE", f"/v1/runs/{quote(run_id, safe='')}")
        except ProviderJobError:
            LOGGER.warning("Inline Core cancel request failed")


def _find_output_descriptor(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        if isinstance(value.get("filename"), str):
            return value
        for child in value.values():
            found = _find_output_descriptor(child)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_output_descriptor(child)
            if found is not None:
                return found
    return None


def _build_wan22_prompt(
    profile: ProviderProfile,
    *,
    image_ref: str,
    positive: str,
    negative: str,
    width: int,
    height: int,
    length: int,
    seed: int,
    filename_prefix: str,
    steps: int,
    cfg: float,
    fps: float,
) -> dict[str, Any]:
    switch_step = min(max(1, profile.switch_step), max(1, steps - 1))
    return {
        "10": {"class_type": "UNETLoader", "inputs": {"unet_name": profile.unet_high, "weight_dtype": "default"}},
        "11": {"class_type": "UNETLoader", "inputs": {"unet_name": profile.unet_low, "weight_dtype": "default"}},
        "12": {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": profile.lora_high, "strength_model": 1.0, "model": ["10", 0]}},
        "13": {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": profile.lora_low, "strength_model": 1.0, "model": ["11", 0]}},
        "14": {"class_type": "ModelSamplingSD3", "inputs": {"shift": 5.0, "model": ["12", 0]}},
        "15": {"class_type": "ModelSamplingSD3", "inputs": {"shift": 5.0, "model": ["13", 0]}},
        "16": {"class_type": "CLIPLoader", "inputs": {"clip_name": profile.clip, "type": "wan", "device": "default"}},
        "17": {"class_type": "VAELoader", "inputs": {"vae_name": profile.vae}},
        "20": {"class_type": "LoadImage", "inputs": {"image": image_ref}},
        "21": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["16", 0]}},
        "22": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["16", 0]}},
        "30": {"class_type": "WanImageToVideo", "inputs": {"positive": ["21", 0], "negative": ["22", 0], "vae": ["17", 0], "width": width, "height": height, "length": length, "batch_size": 1, "start_image": ["20", 0]}},
        "40": {"class_type": "KSamplerAdvanced", "inputs": {"model": ["14", 0], "add_noise": "enable", "noise_seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "euler", "scheduler": "simple", "positive": ["30", 0], "negative": ["30", 1], "latent_image": ["30", 2], "start_at_step": 0, "end_at_step": switch_step, "return_with_leftover_noise": "enable"}},
        "41": {"class_type": "KSamplerAdvanced", "inputs": {"model": ["15", 0], "add_noise": "disable", "noise_seed": 0, "steps": steps, "cfg": cfg, "sampler_name": "euler", "scheduler": "simple", "positive": ["30", 0], "negative": ["30", 1], "latent_image": ["40", 0], "start_at_step": switch_step, "end_at_step": 10000, "return_with_leftover_noise": "disable"}},
        "50": {"class_type": "VAEDecode", "inputs": {"samples": ["41", 0], "vae": ["17", 0]}},
        "60": {"class_type": "CreateVideo", "inputs": {"images": ["50", 0], "fps": fps}},
        "70": {"class_type": "SaveVideo", "inputs": {"video": ["60", 0], "filename_prefix": filename_prefix, "format": "auto", "codec": "auto"}},
    }


def _build_comfyui_h3_prompt(
    profile: ProviderProfile,
    *,
    first_frame_ref: str | None,
    reference_image_refs: list[str],
    reference_roles: list[str],
    positive: str,
    width: int,
    height: int,
    length: int,
    seed: int,
    filename_prefix: str,
    steps: int,
    fps: float,
) -> dict[str, Any]:
    nodes: dict[str, Any] = {
        "10": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": profile.transformer, "weight_dtype": "default"},
        },
        "11": {
            "class_type": "MiniMaxH3TurboLoRA",
            "inputs": {
                "model": ["10", 0],
                "lora_name": profile.turbo_lora,
                "strength": 1.0,
                "low_vram": False,
            },
        },
        "12": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": profile.text_encoder,
                "type": "minimax",
                "device": "default",
            },
        },
        "13": {"class_type": "VAELoader", "inputs": {"vae_name": profile.video_vae}},
        "14": {"class_type": "VAELoader", "inputs": {"vae_name": profile.audio_vae}},
    }
    conditioning_inputs: dict[str, Any] = {
        "clip": ["12", 0],
        "vae": ["13", 0],
        "prompt": positive,
        "width": width,
        "height": height,
        "length": length,
    }
    if first_frame_ref:
        nodes["20"] = {
            "class_type": "LoadImage",
            "inputs": {"image": first_frame_ref},
        }
        conditioning_inputs["first_frame"] = ["20", 0]
    reference_instructions: list[str] = []
    for index, image_ref in enumerate(reference_image_refs, start=1):
        node_id = str(20 + index)
        nodes[node_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": image_ref},
        }
        conditioning_inputs[f"reference_image_{index}"] = [node_id, 0]
        role = reference_roles[index - 1]
        if role == "style":
            reference_instructions.append(
                f"Use <Picture {index}> only as a visual style, lighting, color, and texture reference."
            )
        else:
            reference_instructions.append(
                f"Use <Picture {index}> as a subject identity and appearance reference."
            )
    if reference_instructions:
        conditioning_inputs["prompt"] = (
            positive
            + "\n\nReference image instructions:\n"
            + "\n".join(reference_instructions)
        )
    nodes["30"] = {
        "class_type": "YDCMiniMaxH3MultiReferenceToVideo",
        "inputs": conditioning_inputs,
    }
    nodes.update(
        {
            "40": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
            "41": {
                "class_type": "BasicScheduler",
                "inputs": {
                    "model": ["11", 0],
                    "scheduler": "simple",
                    "steps": steps,
                    "denoise": 1.0,
                },
            },
            "42": {"class_type": "MiniMaxH3TurboSampler", "inputs": {}},
            "43": {
                "class_type": "BasicGuider",
                "inputs": {"model": ["11", 0], "conditioning": ["30", 0]},
            },
            "44": {
                "class_type": "SamplerCustomAdvanced",
                "inputs": {
                    "noise": ["40", 0],
                    "guider": ["43", 0],
                    "sampler": ["42", 0],
                    "sigmas": ["41", 0],
                    "latent_image": ["30", 1],
                },
            },
            "50": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["44", 0], "vae": ["13", 0]},
            },
            "51": {
                "class_type": "VAEDecodeAudio",
                "inputs": {"samples": ["44", 0], "vae": ["14", 0]},
            },
            "60": {
                "class_type": "CreateVideo",
                "inputs": {"images": ["50", 0], "audio": ["51", 0], "fps": fps},
            },
            "70": {
                "class_type": "SaveVideo",
                "inputs": {
                    "video": ["60", 0],
                    "filename_prefix": filename_prefix,
                    "format": "auto",
                    "codec": "auto",
                },
            },
        }
    )
    return nodes


def _build_comfyui_h3_official_i2v_prompt(
    profile: ProviderProfile,
    *,
    first_frame_ref: str | None,
    reference_image_refs: list[str],
    positive: str,
    width: int,
    height: int,
    length: int,
    seed: int,
    filename_prefix: str,
    steps: int,
    fps: float,
) -> dict[str, Any]:
    """Build the pinned Comfy-Org H3 I2V baseline in API prompt format."""
    if reference_image_refs:
        raise ProviderJobError(
            "profile_reference_images_unsupported",
            "the selected official H3 I2V workflow does not support extra reference images",
        )
    nodes: dict[str, Any] = {
        "10": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": profile.transformer, "weight_dtype": "default"},
        },
        "12": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": profile.text_encoder,
                "type": "minimax",
                "device": "default",
            },
        },
        "13": {"class_type": "VAELoader", "inputs": {"vae_name": profile.video_vae}},
        "14": {"class_type": "VAELoader", "inputs": {"vae_name": profile.audio_vae}},
    }
    conditioning_inputs: dict[str, Any] = {
        "clip": ["12", 0],
        "vae": ["13", 0],
        "prompt": positive,
        "width": width,
        "height": height,
        "length": length,
    }
    if first_frame_ref:
        nodes["20"] = {
            "class_type": "LoadImage",
            "inputs": {"image": first_frame_ref},
        }
        conditioning_inputs["first_frame"] = ["20", 0]
    nodes["30"] = {
        "class_type": "MiniMaxH3ImageToVideo",
        "inputs": conditioning_inputs,
    }
    official_steps = max(steps, profile.default_steps)
    nodes.update(
        {
            "40": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
            "41": {
                "class_type": "BasicScheduler",
                "inputs": {
                    "model": ["10", 0],
                    "scheduler": "simple",
                    "steps": official_steps,
                    "denoise": 1.0,
                },
            },
            "42": {
                "class_type": "KSamplerSelect",
                "inputs": {"sampler_name": "res_multistep"},
            },
            "43": {
                "class_type": "BasicGuider",
                "inputs": {"model": ["10", 0], "conditioning": ["30", 0]},
            },
            "44": {
                "class_type": "SamplerCustomAdvanced",
                "inputs": {
                    "noise": ["40", 0],
                    "guider": ["43", 0],
                    "sampler": ["42", 0],
                    "sigmas": ["41", 0],
                    "latent_image": ["30", 1],
                },
            },
            "50": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["44", 0], "vae": ["13", 0]},
            },
            "51": {
                "class_type": "VAEDecodeAudio",
                "inputs": {"samples": ["44", 0], "vae": ["14", 0]},
            },
            "60": {
                "class_type": "CreateVideo",
                "inputs": {"images": ["50", 0], "audio": ["51", 0], "fps": fps},
            },
            "70": {
                "class_type": "SaveVideo",
                "inputs": {
                    "video": ["60", 0],
                    "filename_prefix": filename_prefix,
                    "format": "auto",
                    "codec": "auto",
                },
            },
        }
    )
    return nodes


def _build_comfyui_h3_ref2va_prompt(
    profile: ProviderProfile,
    *,
    source_video_ref: str,
    reference_video_refs: list[str],
    reference_image_refs: list[str],
    reference_roles: list[str],
    positive: str,
    width: int,
    height: int,
    length: int,
    seed: int,
    filename_prefix: str,
    steps: int,
    fps: float,
    preserve_source_audio: bool,
) -> dict[str, Any]:
    nodes: dict[str, Any] = {
        "10": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": profile.transformer, "weight_dtype": "default"},
        },
        "11": {
            "class_type": "MiniMaxH3SigmaShift",
            "inputs": {
                "model": ["10", 0],
                "shift_video": 12.0,
                "shift_audio": 3.0,
            },
        },
        "12": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": profile.text_encoder,
                "type": "minimax",
                "device": "default",
            },
        },
        "13": {"class_type": "VAELoader", "inputs": {"vae_name": profile.video_vae}},
        "14": {"class_type": "VAELoader", "inputs": {"vae_name": profile.audio_vae}},
        "20": {"class_type": "LoadVideo", "inputs": {"file": source_video_ref}},
        "21": {"class_type": "GetVideoComponents", "inputs": {"video": ["20", 0]}},
    }
    instructions = [
        "<Video 1> is the source clip to edit. Preserve its subject identity, camera geometry, and temporal continuity outside the requested change.",
    ]
    conditioning_inputs: dict[str, Any] = {
        "clip": ["12", 0],
        "vae": ["13", 0],
        "audio_vae": ["14", 0],
        "prompt": positive,
        "width": width,
        "height": height,
        "length": length,
        "ref_image_size": "match",
        "ref_videos.ref_video_0": ["21", 0],
    }
    if preserve_source_audio:
        conditioning_inputs["ref_video_audios.ref_video_audio_0"] = ["21", 1]
        instructions.append(
            "<Audio 1> is the synchronized source soundtrack; keep speech timing, ambience, and sound continuity unless the edit explicitly requests an audio change."
        )
    for index, video_ref in enumerate(reference_video_refs, start=1):
        load_node_id = str(80 + index * 2)
        components_node_id = str(81 + index * 2)
        nodes[load_node_id] = {
            "class_type": "LoadVideo",
            "inputs": {"file": video_ref},
        }
        nodes[components_node_id] = {
            "class_type": "GetVideoComponents",
            "inputs": {"video": [load_node_id, 0]},
        }
        conditioning_inputs[f"ref_videos.ref_video_{index}"] = [
            components_node_id,
            0,
        ]
        if preserve_source_audio:
            conditioning_inputs[f"ref_video_audios.ref_video_audio_{index}"] = [
                components_node_id,
                1,
            ]
        instructions.append(
            f"Use <Video {index + 1}> only as an additional motion and continuity reference."
        )
    for index, image_ref in enumerate(reference_image_refs):
        node_id = str(22 + index)
        picture_number = index + 1
        nodes[node_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": image_ref},
        }
        conditioning_inputs[f"ref_images.ref_image_{index}"] = [node_id, 0]
        role = reference_roles[index]
        if role == "style":
            instructions.append(
                f"Use <Picture {picture_number}> only for visual style, lighting, color, and texture."
            )
        else:
            instructions.append(
                f"Use <Picture {picture_number}> as the requested subject identity and appearance reference."
            )
    conditioning_inputs["prompt"] = (
        "Video editing instruction:\n"
        + positive
        + "\n\nReference mapping:\n"
        + "\n".join(instructions)
    )
    nodes["30"] = {
        "class_type": "MiniMaxH3ReferenceToVideo",
        "inputs": conditioning_inputs,
    }
    nodes.update(
        {
            "40": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
            "41": {
                "class_type": "BasicScheduler",
                "inputs": {
                    "model": ["11", 0],
                    "scheduler": "beta",
                    "steps": steps,
                    "denoise": 1.0,
                },
            },
            "42": {
                "class_type": "KSamplerSelect",
                "inputs": {"sampler_name": "res_multistep"},
            },
            "43": {
                "class_type": "BasicGuider",
                "inputs": {"model": ["11", 0], "conditioning": ["30", 0]},
            },
            "44": {
                "class_type": "SamplerCustomAdvanced",
                "inputs": {
                    "noise": ["40", 0],
                    "guider": ["43", 0],
                    "sampler": ["42", 0],
                    "sigmas": ["41", 0],
                    "latent_image": ["30", 1],
                },
            },
            "50": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["44", 0], "vae": ["13", 0]},
            },
            "51": {
                "class_type": "VAEDecodeAudio",
                "inputs": {"samples": ["44", 0], "vae": ["14", 0]},
            },
            "60": {
                "class_type": "CreateVideo",
                "inputs": {"images": ["50", 0], "audio": ["51", 0], "fps": fps},
            },
            "70": {
                "class_type": "SaveVideo",
                "inputs": {
                    "video": ["60", 0],
                    "filename_prefix": filename_prefix,
                    "format": "auto",
                    "codec": "auto",
                },
            },
        }
    )
    return nodes


def _build_comfyui_hidream_o1_image_prompt(
    profile: ProviderProfile,
    *,
    reference_image_refs: list[str],
    positive: str,
    negative: str,
    width: int,
    height: int,
    seed: int,
    filename_prefix: str,
    steps: int,
    cfg: float,
) -> dict[str, Any]:
    """Build the versioned HiDream-O1 graph verified on the 5090 ComfyUI host."""
    nodes: dict[str, Any] = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": profile.checkpoint},
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": positive, "clip": ["1", 1]},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative, "clip": ["1", 1]},
        },
        "4": {
            "class_type": "ModelNoiseScale",
            "inputs": {"model": ["1", 0], "noise_scale": 8.0},
        },
        "5": {
            "class_type": "HiDreamO1PatchSeamSmoothing",
            "inputs": {
                "model": ["4", 0],
                "start_percent": 0.8,
                "end_percent": 1.0,
                "pattern": "single_shift",
                "passes": "2",
                "blend": "average",
                "strength": 1.0,
            },
        },
        "6": {
            "class_type": "EmptyHiDreamO1LatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "7": {
            "class_type": "BasicScheduler",
            "inputs": {
                "model": ["4", 0],
                "scheduler": "normal",
                "steps": steps,
                "denoise": 1.0,
            },
        },
        "8": {
            "class_type": "KSamplerSelect",
            "inputs": {"sampler_name": "dpmpp_2m_sde_gpu"},
        },
    }
    positive_ref: list[Any] = ["2", 0]
    negative_ref: list[Any] = ["3", 0]
    if reference_image_refs:
        image_inputs: dict[str, list[Any]] = {}
        for index, image_ref in enumerate(reference_image_refs, start=1):
            node_id = str(20 + index)
            nodes[node_id] = {
                "class_type": "LoadImage",
                "inputs": {"image": image_ref},
            }
            image_inputs[f"image_{index}"] = [node_id, 0]
        nodes["19"] = {
            "class_type": "HiDreamO1ReferenceImages",
            "inputs": {
                "positive": ["2", 0],
                "negative": ["3", 0],
                "images": image_inputs,
            },
        }
        positive_ref = ["19", 0]
        negative_ref = ["19", 1]
    nodes.update(
        {
            "9": {
                "class_type": "SamplerCustom",
                "inputs": {
                    "model": ["5", 0],
                    "add_noise": True,
                    "noise_seed": seed,
                    "cfg": cfg,
                    "positive": positive_ref,
                    "negative": negative_ref,
                    "sampler": ["8", 0],
                    "sigmas": ["7", 0],
                    "latent_image": ["6", 0],
                },
            },
            "10": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["9", 0], "vae": ["1", 2]},
            },
            "70": {
                "class_type": "SaveImage",
                "inputs": {"images": ["10", 0], "filename_prefix": filename_prefix},
            },
        }
    )
    return nodes


class ProviderService:
    def __init__(
        self,
        config: ProviderConfig,
        *,
        comfyui: ComfyUiClient | None = None,
        inline_core: InlineCoreClient | None = None,
        executor: ThreadPoolExecutor | None = None,
        inline_core_unloader: Callable[[], None] | None = None,
        inline_core_available_ram_gb: Callable[[], float | None] | None = None,
    ) -> None:
        self.config = config
        self.comfyui = comfyui or (ComfyUiClient(config.comfyui_url) if config.comfyui_url else None)
        self.inline_core = inline_core or (
            InlineCoreClient(config.inline_core_url) if config.inline_core_url else None
        )
        self.executor = executor or ThreadPoolExecutor(max_workers=1, thread_name_prefix="ydc-media")
        self._lock = threading.RLock()
        self._scheduled: set[str] = set()
        self._inline_core_unloader = inline_core_unloader or self._restart_inline_core_service
        self._inline_core_available_ram_gb = (
            inline_core_available_ram_gb or _available_ram_gb
        )
        self._idle_unload_timer: threading.Timer | None = None
        self._idle_unload_generation = 0
        self._last_h3_activity_monotonic = time.monotonic()
        self._last_inline_core_unloaded_at: str | None = None
        self._last_inline_core_unload_reason: str | None = None
        self._inline_core_unload_count = 0
        self._active_comfyui_transformer: str | None = None
        self.config.state_root.mkdir(parents=True, exist_ok=True)
        self._recover_pending_jobs()
        with self._lock:
            self._arm_idle_unload_locked(reset_deadline=True)

    def healthcheck(self) -> dict[str, Any]:
        wan_profiles = {
            name: profile for name, profile in self.config.profiles.items()
            if profile.adapter == COMFYUI_WAN22_ADAPTER_KIND
        }
        h3_profiles = {
            name: profile for name, profile in self.config.profiles.items()
            if profile.adapter == INLINE_CORE_H3_ADAPTER_KIND
        }
        comfyui_h3_profiles = {
            name: profile for name, profile in self.config.profiles.items()
            if profile.adapter in COMFYUI_H3_ADAPTER_KINDS
        }
        hidream_image_profiles = {
            name: profile for name, profile in self.config.profiles.items()
            if profile.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND
        }
        values: list[dict[str, Any]] = []
        if wan_profiles:
            if self.comfyui is None:
                raise ProviderJobError("comfyui_unavailable", "platform generation backend is unavailable")
            values.append(self.comfyui.healthcheck(wan_profiles))
        if h3_profiles:
            if self.inline_core is None:
                raise ProviderJobError("inline_core_unavailable", "platform H3 generation backend is unavailable")
            values.append(self.inline_core.healthcheck(h3_profiles))
        if comfyui_h3_profiles:
            if self.comfyui is None:
                raise ProviderJobError(
                    "comfyui_unavailable", "platform H3 generation backend is unavailable"
                )
            values.append(self.comfyui.healthcheck_h3(comfyui_h3_profiles))
        if hidream_image_profiles:
            if self.comfyui is None:
                raise ProviderJobError(
                    "comfyui_unavailable", "platform HiDream image backend is unavailable"
                )
            values.append(
                self.comfyui.healthcheck_hidream_image(hidream_image_profiles)
            )
        value = values[0] if len(values) == 1 else {
            "status": "healthy",
            "profiles": sorted(self.config.profiles),
            "backends": values,
        }
        profile_details = []
        for name, profile in sorted(self.config.profiles.items()):
            if profile.adapter in {
                COMFYUI_H3_ADAPTER_KIND,
                COMFYUI_H3_OFFICIAL_I2V_ADAPTER_KIND,
                INLINE_CORE_H3_ADAPTER_KIND,
            }:
                kind = "generate"
                max_reference_images = (
                    4 if profile.adapter == COMFYUI_H3_ADAPTER_KIND else 0
                )
            elif profile.adapter == COMFYUI_H3_REF2VA_ADAPTER_KIND:
                kind = "edit"
                max_reference_images = 4
            elif profile.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND:
                kind = "image"
                max_reference_images = 4
            else:
                kind = "legacy"
                max_reference_images = 0
            minimum_steps = (
                profile.default_steps
                if profile.adapter
                in {
                    COMFYUI_H3_OFFICIAL_I2V_ADAPTER_KIND,
                    COMFYUI_H3_REF2VA_ADAPTER_KIND,
                }
                else 1
            )
            profile_details.append(
                {
                    "id": name,
                    "kind": kind,
                    "adapter": profile.adapter,
                    "workflow_version": profile.workflow_version,
                    "model_version": profile.model_version,
                    "max_reference_images": max_reference_images,
                    "minimum_steps": minimum_steps,
                }
            )
        return {
            **value,
            "profile_details": profile_details,
            "provider_version": self.config.provider_version,
            "contract": REQUEST_CONTRACT,
            "resource_lifecycle": self.resource_lifecycle(),
        }

    def resource_lifecycle(self) -> dict[str, Any]:
        with self._lock:
            active = self._has_active_h3_jobs_locked()
            timer = self._idle_unload_timer
            available_ram_gb = self._probe_available_ram_gb_locked()
            return {
                "backend": (
                    "comfyui_h3"
                    if any(
                        profile.adapter in COMFYUI_H3_ADAPTER_KINDS
                        for profile in self.config.profiles.values()
                    )
                    else "inline_core"
                ),
                "idle_unload_seconds": self.config.inline_core_idle_unload_seconds,
                "memory_pressure_unload_gb": (
                    self.config.inline_core_memory_pressure_unload_gb
                ),
                "memory_pressure_min_idle_seconds": (
                    self.config.inline_core_memory_pressure_min_idle_seconds
                ),
                "memory_pressure_check_seconds": (
                    self.config.inline_core_memory_pressure_check_seconds
                ),
                "available_ram_gb": (
                    round(available_ram_gb, 2) if available_ram_gb is not None else None
                ),
                "active_h3_jobs": active,
                "idle_unload_armed": bool(timer is not None and timer.is_alive()),
                "last_unloaded_at": self._last_inline_core_unloaded_at,
                "last_unload_reason": self._last_inline_core_unload_reason,
                "unload_count": self._inline_core_unload_count,
                "active_transformer": self._active_comfyui_transformer,
            }

    def unload_inline_core(self, *, reason: str = "manual") -> dict[str, Any]:
        with self._lock:
            if self._has_active_h3_jobs_locked():
                raise ProviderJobError(
                    "provider_resource_busy",
                    "H3 resources cannot be unloaded while generation is active",
                    failure_stage="provider_backend",
                    retryable=True,
                )
            self._cancel_idle_unload_locked()
            self._perform_inline_core_unload_locked(reason=reason)
            return self.resource_lifecycle()

    def submit(self, payload: Any) -> dict[str, Any]:
        request = self._normalize_request(payload)
        identity = f"{request['orchestration_run_id']}:{request['attempt']}"
        job_id = "gmjob_" + hashlib.sha256(identity.encode()).hexdigest()[:32]
        request_checksum = _checksum(_canonical_json(request))
        profile_name = str(request.get("generation_spec", {}).get("profile") or "")
        profile = self.config.profiles.get(profile_name)
        is_h3 = profile is not None and profile.adapter in H3_ADAPTER_KINDS
        with self._lock:
            current = self._read_job(job_id)
            if current is not None:
                if current.get("request_checksum") != request_checksum:
                    raise ProviderJobError(
                        "immutable_job_conflict",
                        "generated-media job identity already has different content",
                    )
                if is_h3 and current.get("status") in ACTIVE_JOB_STATUSES:
                    self._cancel_idle_unload_locked()
                self._schedule_if_needed(job_id, current)
                return self.public_job(current)
            if is_h3:
                self._cancel_idle_unload_locked()
            now = _utc_now()
            job = {
                "job_id": job_id,
                "status": "queued",
                "created_at": now,
                "updated_at": now,
                "request": request,
                "request_checksum": request_checksum,
                "samples": [],
                "cancel_requested": False,
            }
            self._write_job(job)
            self._schedule_if_needed(job_id, job)
            return self.public_job(job)

    def get(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            job = self._read_job(job_id)
            if job is None:
                raise ProviderJobError("job_not_found", "generated-media job was not found")
            return self.public_job(job)

    def cancel(self, job_id: str) -> dict[str, Any]:
        interrupt = False
        with self._lock:
            job = self._read_job(job_id)
            if job is None:
                raise ProviderJobError("job_not_found", "generated-media job was not found")
            if job.get("status") in {"succeeded", "failed", "canceled"}:
                return self.public_job(job)
            job["cancel_requested"] = True
            if job.get("status") == "queued":
                job["status"] = "canceled"
                job["finished_at"] = _utc_now()
            else:
                job["status"] = "canceling"
                interrupt = True
            job["updated_at"] = _utc_now()
            self._write_job(job)
            if job.get("status") == "canceled" and self._is_h3_job(job):
                self._arm_idle_unload_locked(reset_deadline=True)
            result = self.public_job(job)
        if interrupt:
            request = job.get("request") if isinstance(job.get("request"), dict) else {}
            spec = request.get("generation_spec") if isinstance(request.get("generation_spec"), dict) else {}
            profile = self.config.profiles.get(str(spec.get("profile") or ""))
            if profile is not None and profile.adapter == INLINE_CORE_H3_ADAPTER_KIND:
                run_id = str(job.get("current_run_id") or "")
                if run_id and self.inline_core is not None:
                    self.inline_core.cancel(run_id)
            elif self.comfyui is not None:
                self.comfyui.interrupt()
        return result

    def public_job(self, job: dict[str, Any]) -> dict[str, Any]:
        value = {
            key: job[key]
            for key in (
                "job_id",
                "status",
                "created_at",
                "updated_at",
                "started_at",
                "finished_at",
                "failure_stage",
                "error_code",
                "error_message",
                "retryable",
            )
            if job.get(key) is not None
        }
        value["provider_version"] = self.config.provider_version
        request = job.get("request") if isinstance(job.get("request"), dict) else {}
        profile = self.config.profiles.get(str(request.get("generation_spec", {}).get("profile") or ""))
        if profile is not None:
            value["model_version"] = profile.model_version
            value["workflow_version"] = profile.workflow_version
        if job.get("status") == "succeeded":
            samples: list[dict[str, Any]] = []
            for sample in job.get("samples") or []:
                if not isinstance(sample, dict):
                    continue
                path = self._job_dir(str(job["job_id"])) / str(sample["storage_path"])
                content = path.read_bytes()
                if _checksum(content) != sample.get("checksum"):
                    raise ProviderJobError(
                        "provider_output_corrupt",
                        "generated-media provider output checksum mismatch",
                    )
                samples.append(
                    {
                        key: sample[key]
                        for key in (
                            "sample_id",
                            "label",
                            "filename",
                            "checksum",
                            "content_type",
                            "contract",
                        )
                    }
                    | {"content_base64": base64.b64encode(content).decode()}
                )
            value["samples"] = samples
        return value

    def _normalize_request(self, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict) or payload.get("schema_version") != REQUEST_CONTRACT:
            raise ProviderJobError("invalid_request", "generated-media request contract is invalid")
        generation_spec = payload.get("generation_spec")
        if not isinstance(generation_spec, dict):
            raise ProviderJobError("invalid_generation_spec", "generation_spec is required")
        declared_checksum = _required_string(
            payload.get("generation_spec_checksum"),
            "generation_spec_checksum",
        )
        if declared_checksum != _checksum(_canonical_json(generation_spec)):
            raise ProviderJobError(
                "generation_spec_checksum_mismatch",
                "generation_spec checksum does not match",
            )
        profile_name = _required_string(generation_spec.get("profile"), "generation_spec.profile")
        profile = self.config.profiles.get(profile_name)
        if profile is None:
            raise ProviderJobError(
                "generation_profile_not_supported",
                "generation profile is not supported by the platform",
            )
        parameters = generation_spec.get("parameters")
        if not isinstance(parameters, dict):
            raise ProviderJobError("invalid_generation_spec", "generation_spec.parameters is required")
        unexpected = sorted(set(parameters) - ALLOWED_PARAMETERS)
        if unexpected:
            raise ProviderJobError(
                "invalid_generation_spec",
                "generation_spec contains unsupported parameters",
            )
        prompts = parameters.get("behavior_prompts")
        if prompts is None:
            prompts = profile.default_behavior_prompts
        if not isinstance(prompts, dict) or not prompts:
            raise ProviderJobError(
                "behavior_prompts_required",
                "generation_spec.behavior_prompts is required",
            )
        normalized_prompts = {
            _required_string(label, "behavior label"): _required_string(prompt, "behavior prompt")
            for label, prompt in prompts.items()
        }
        deficits = payload.get("deficits")
        if not isinstance(deficits, dict) or not deficits:
            raise ProviderJobError("invalid_request", "deficits are required")
        normalized_deficits: dict[str, int] = {}
        for label, count in deficits.items():
            normalized_label = _required_string(label, "deficit label")
            normalized_deficits[normalized_label] = _bounded_int(count, "deficit", 1, self.config.max_outputs)
            if normalized_label not in normalized_prompts:
                raise ProviderJobError(
                    "behavior_prompt_missing",
                    "generation_spec is missing a deficit behavior prompt",
                )
        max_outputs = _bounded_int(payload.get("max_outputs"), "max_outputs", 1, self.config.max_outputs)
        source_artifacts = payload.get("source_artifacts", [])
        if source_artifacts is None:
            source_artifacts = []
        source_optional_adapters = {
            COMFYUI_H3_ADAPTER_KIND,
            COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND,
        }
        if not isinstance(source_artifacts, list) or (
            not source_artifacts and profile.adapter not in source_optional_adapters
        ):
            raise ProviderJobError("source_artifacts_required", "source_artifacts are required")
        normalized_sources: list[dict[str, Any]] = []
        total_bytes = 0
        for source_index, source in enumerate(source_artifacts):
            if not isinstance(source, dict):
                raise ProviderJobError("invalid_source_artifact", "source artifact is invalid")
            encoded = source.get("content_base64")
            if not isinstance(encoded, str):
                raise ProviderJobError(
                    "source_artifact_content_required",
                    "source artifact content is required",
                )
            try:
                content = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ProviderJobError("invalid_source_artifact", "source artifact content is invalid") from exc
            total_bytes += len(content)
            if total_bytes > self.config.max_source_bytes:
                raise ProviderJobError("source_artifacts_too_large", "source artifacts exceed platform limits")
            checksum = _required_string(source.get("checksum"), "source artifact checksum")
            if checksum != _checksum(content):
                raise ProviderJobError(
                    "source_artifact_checksum_mismatch",
                    "source artifact checksum does not match",
                )
            content_type = _required_string(source.get("content_type"), "source artifact content_type")
            is_image = content_type in {"image/jpeg", "image/png", "image/webp"}
            is_video = content_type in {"video/mp4", "video/webm", "video/quicktime"}
            if profile.adapter == COMFYUI_H3_REF2VA_ADAPTER_KIND:
                type_supported = is_image or is_video
            else:
                type_supported = is_image
            if not type_supported:
                raise ProviderJobError(
                    "source_artifact_type_unsupported",
                    "generation source artifact type is not supported",
                )
            default_role = (
                "source_video"
                if profile.adapter == COMFYUI_H3_REF2VA_ADAPTER_KIND and is_video
                else (
                    "reference"
                    if profile.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND
                    else ("first_frame" if source_index == 0 else "subject")
                )
            )
            role = str(source.get("role") or default_role).strip()
            if profile.adapter == COMFYUI_H3_REF2VA_ADAPTER_KIND:
                allowed_roles = {"source_video", "reference_video", "style", "subject"}
            elif profile.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND:
                allowed_roles = {"reference"}
            else:
                allowed_roles = {"first_frame", "style", "subject"}
            if role not in allowed_roles:
                raise ProviderJobError(
                    "invalid_source_artifact",
                    "source artifact role is not supported by the selected profile",
                )
            if is_video != (role in {"source_video", "reference_video"}):
                raise ProviderJobError(
                    "invalid_source_artifact",
                    "video roles require video files and image roles require image files",
                )
            normalized_sources.append(
                {
                    "name": _required_string(source.get("name"), "source artifact name"),
                    "checksum": checksum,
                    "content_type": content_type,
                    "contract": str(source.get("contract") or "generated_media_source.v1"),
                    "role": role,
                    "content_base64": encoded,
                }
            )
        if profile.adapter == COMFYUI_H3_REF2VA_ADAPTER_KIND:
            source_video_count = sum(
                source["role"] == "source_video" for source in normalized_sources
            )
            video_count = sum(
                source["role"] in {"source_video", "reference_video"}
                for source in normalized_sources
            )
            image_count = len(normalized_sources) - video_count
            if source_video_count != 1 or video_count > 3 or image_count > 9:
                raise ProviderJobError(
                    "invalid_source_artifact",
                    "Ref2VA requires one source video and accepts up to three videos and nine images",
                )
        elif profile.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND:
            if len(normalized_sources) > 4:
                raise ProviderJobError(
                    "invalid_source_artifact",
                    "HiDream image editing accepts up to four reference images",
                )
        else:
            first_frame_count = sum(
                source["role"] == "first_frame" for source in normalized_sources
            )
            reference_count = len(normalized_sources) - first_frame_count
            if first_frame_count > 1 or reference_count > 4 or len(normalized_sources) > 5:
                raise ProviderJobError(
                    "invalid_source_artifact",
                    "H3 accepts one first frame and up to four reference images",
                )
        normalized_parameters = dict(parameters)
        normalized_parameters["behavior_prompts"] = normalized_prompts
        normalized_parameters["width"] = _bounded_int(parameters.get("width", profile.default_width), "width", 64, profile.max_width)
        normalized_parameters["height"] = _bounded_int(parameters.get("height", profile.default_height), "height", 64, profile.max_height)
        if profile.adapter in {
            *H3_ADAPTER_KINDS,
            COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND,
        } and (
            normalized_parameters["width"] % 32 != 0 or normalized_parameters["height"] % 32 != 0
        ):
            raise ProviderJobError("invalid_generation_spec", "width and height must be multiples of 32")
        if profile.adapter != COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND:
            length_value = parameters.get("length", parameters.get("duration_frames", profile.default_length))
            normalized_parameters["length"] = _bounded_int(length_value, "length", 5, profile.max_length)
            normalized_parameters.pop("duration_frames", None)
            if profile.adapter in COMFYUI_H3_ADAPTER_KINDS:
                if (normalized_parameters["length"] - 5) % 17 != 0:
                    raise ProviderJobError(
                        "invalid_generation_spec", "H3 length must use the 17n+5 frame grid"
                    )
            elif (normalized_parameters["length"] - 1) % 4 != 0:
                raise ProviderJobError("invalid_generation_spec", "length must be 4n+1")
            normalized_parameters["fps"] = _bounded_float(parameters.get("fps", profile.default_fps), "fps", 1, 60)
        normalized_parameters["steps"] = _bounded_int(parameters.get("steps", profile.default_steps), "steps", 2, 100)
        normalized_parameters["cfg"] = _bounded_float(parameters.get("cfg", profile.default_cfg), "cfg", 0, 30)
        normalized_parameters["negative_prompt"] = str(parameters.get("negative_prompt", profile.default_negative_prompt))
        if profile.adapter != COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND:
            preserve_source_audio = parameters.get("preserve_source_audio", True)
            if not isinstance(preserve_source_audio, bool):
                raise ProviderJobError(
                    "invalid_generation_spec",
                    "preserve_source_audio must be a boolean",
                )
            normalized_parameters["preserve_source_audio"] = preserve_source_audio
        if parameters.get("seed") is not None:
            normalized_parameters["seed"] = _bounded_int(
                parameters["seed"],
                "seed",
                0,
                2**63 - 1,
            )
        return {
            "schema_version": REQUEST_CONTRACT,
            "orchestration_run_id": _required_string(payload.get("orchestration_run_id"), "orchestration_run_id"),
            "project_id": _required_string(payload.get("project_id"), "project_id"),
            "attempt": _bounded_int(payload.get("attempt"), "attempt", 1, 1000),
            "deficits": normalized_deficits,
            "max_outputs": max_outputs,
            "generation_spec": generation_spec,
            "generation_spec_checksum": declared_checksum,
            "runtime_parameters": normalized_parameters,
            "source_artifacts": normalized_sources,
        }

    def _recover_pending_jobs(self) -> None:
        for path in sorted(self.config.state_root.glob("gmjob_*/job.json")):
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                LOGGER.error("ignoring unreadable generated-media provider job state")
                continue
            if isinstance(job, dict) and job.get("status") in {"queued", "running", "canceling"}:
                if job.get("cancel_requested"):
                    job["status"] = "canceled"
                    job["finished_at"] = _utc_now()
                    self._write_job(job)
                else:
                    job["status"] = "queued"
                    self._write_job(job)
                    self._schedule_if_needed(str(job["job_id"]), job)

    def _is_h3_job(self, job: dict[str, Any]) -> bool:
        request = job.get("request") if isinstance(job.get("request"), dict) else {}
        spec = (
            request.get("generation_spec")
            if isinstance(request.get("generation_spec"), dict)
            else {}
        )
        profile = self.config.profiles.get(str(spec.get("profile") or ""))
        return profile is not None and profile.adapter in H3_ADAPTER_KINDS

    def _has_active_h3_jobs_locked(self) -> bool:
        for path in sorted(self.config.state_root.glob("gmjob_*/job.json")):
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                LOGGER.warning("blocking H3 unload because provider job state is unreadable")
                return True
            if not isinstance(job, dict) or job.get("status") not in ACTIVE_JOB_STATUSES:
                continue
            if self._is_h3_job(job):
                return True
            request = job.get("request") if isinstance(job.get("request"), dict) else {}
            spec = (
                request.get("generation_spec")
                if isinstance(request.get("generation_spec"), dict)
                else {}
            )
            if not str(spec.get("profile") or ""):
                return True
        return False

    def _has_h3_profiles(self) -> bool:
        return any(
            profile.adapter in H3_ADAPTER_KINDS
            for profile in self.config.profiles.values()
        )

    def _cancel_idle_unload_locked(self) -> None:
        self._idle_unload_generation += 1
        timer = self._idle_unload_timer
        self._idle_unload_timer = None
        if timer is not None:
            timer.cancel()

    def _probe_available_ram_gb_locked(self) -> float | None:
        try:
            value = self._inline_core_available_ram_gb()
            return None if value is None else max(0.0, float(value))
        except Exception:  # noqa: BLE001 - lifecycle probe must never break jobs
            LOGGER.warning("could not measure available RAM for H3 resource lifecycle")
            return None

    def _arm_idle_unload_locked(self, *, reset_deadline: bool = False) -> None:
        seconds = self.config.inline_core_idle_unload_seconds
        if seconds <= 0 or not self._has_h3_profiles() or self._has_active_h3_jobs_locked():
            return
        if reset_deadline:
            self._last_h3_activity_monotonic = time.monotonic()
        self._cancel_idle_unload_locked()
        generation = self._idle_unload_generation
        elapsed = max(0.0, time.monotonic() - self._last_h3_activity_monotonic)
        delay = max(0.01, seconds - elapsed)
        pressure_threshold = self.config.inline_core_memory_pressure_unload_gb
        if pressure_threshold > 0:
            pressure_start = self.config.inline_core_memory_pressure_min_idle_seconds
            if elapsed < pressure_start:
                delay = min(delay, max(0.01, pressure_start - elapsed))
            else:
                delay = min(
                    delay,
                    self.config.inline_core_memory_pressure_check_seconds,
                )
        timer = threading.Timer(delay, self._idle_unload_if_still_idle, args=(generation,))
        timer.daemon = True
        self._idle_unload_timer = timer
        timer.start()

    def _idle_unload_if_still_idle(self, generation: int) -> None:
        with self._lock:
            if generation != self._idle_unload_generation:
                return
            self._idle_unload_timer = None
            if self._has_active_h3_jobs_locked():
                return
            elapsed = time.monotonic() - self._last_h3_activity_monotonic
            reason: str | None = None
            if elapsed >= self.config.inline_core_idle_unload_seconds:
                reason = "idle_timeout"
            elif (
                self.config.inline_core_memory_pressure_unload_gb > 0
                and elapsed
                >= self.config.inline_core_memory_pressure_min_idle_seconds
            ):
                available_ram_gb = self._probe_available_ram_gb_locked()
                if (
                    available_ram_gb is not None
                    and available_ram_gb
                    < self.config.inline_core_memory_pressure_unload_gb
                ):
                    reason = "memory_pressure"
            if reason is None:
                self._arm_idle_unload_locked()
                return
            try:
                self._perform_inline_core_unload_locked(reason=reason)
            except Exception:  # noqa: BLE001 - timer must not terminate the provider
                LOGGER.exception("automatic Inline Core idle unload failed")
                self._arm_idle_unload_locked(reset_deadline=True)

    def _perform_inline_core_unload_locked(self, *, reason: str) -> None:
        try:
            self._inline_core_unloader()
        except ProviderJobError:
            raise
        except Exception as exc:
            raise ProviderJobError(
                "inline_core_unload_failed",
                "platform H3 resources could not be unloaded",
            ) from exc
        self._last_inline_core_unloaded_at = _utc_now()
        self._last_inline_core_unload_reason = reason
        self._inline_core_unload_count += 1
        self._active_comfyui_transformer = None

    def _restart_inline_core_service(self) -> None:
        try:
            subprocess.run(
                ["systemctl", "--user", "restart", self.config.inline_core_service_unit],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=60,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise ProviderJobError(
                "inline_core_unload_failed",
                "platform H3 resources could not be unloaded",
            ) from exc
        deadline = time.monotonic() + 60
        use_comfyui_h3 = any(
            profile.adapter in COMFYUI_H3_ADAPTER_KINDS
            for profile in self.config.profiles.values()
        )
        while time.monotonic() < deadline:
            try:
                if use_comfyui_h3 and self.comfyui is not None:
                    self.comfyui._json("GET", "/system_stats")
                    return
                if self.inline_core is None:
                    return
                if self.inline_core._json("GET", "/v1/health").get("ok") is True:
                    return
            except ProviderJobError:
                pass
            time.sleep(0.5)
        raise ProviderJobError(
            "inline_core_unload_failed",
            "platform H3 backend did not recover after resource unload",
        )

    def _ensure_comfyui_transformer(self, profile: ProviderProfile) -> None:
        if profile.adapter not in {
            *COMFYUI_H3_ADAPTER_KINDS,
            COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND,
        }:
            return
        if self.comfyui is None:
            raise ProviderJobError(
                "comfyui_unavailable",
                "platform ComfyUI generation backend is unavailable",
            )
        active_model = (
            profile.checkpoint
            if profile.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND
            else profile.transformer
        )
        if self._active_comfyui_transformer == active_model:
            return
        LOGGER.info(
            "switching ComfyUI managed model from %s to %s",
            self._active_comfyui_transformer or "unknown",
            active_model,
        )
        self.comfyui.free_memory()
        self._active_comfyui_transformer = active_model

    def _run_or_resume_comfyui_prompt(
        self,
        job_id: str,
        prompt: dict[str, Any],
    ) -> bytes:
        if self.comfyui is None:
            raise ProviderJobError(
                "comfyui_unavailable",
                "platform generation backend is unavailable",
            )
        with self._lock:
            job = self._require_job(job_id)
            prompt_id = str(job.get("current_prompt_id") or "").strip()
        if prompt_id and not self.comfyui.prompt_exists(prompt_id):
            LOGGER.warning(
                "persisted ComfyUI prompt %s is no longer available; requeueing provider job %s",
                prompt_id,
                job_id,
            )
            prompt_id = ""
            with self._lock:
                job = self._require_job(job_id)
                job.pop("current_prompt_id", None)
                job["updated_at"] = _utc_now()
                self._write_job(job)
        if prompt_id:
            LOGGER.info(
                "resuming ComfyUI prompt %s for provider job %s",
                prompt_id,
                job_id,
            )
        else:
            prompt_id = self.comfyui.queue_prompt(prompt, client_id=job_id)
            with self._lock:
                job = self._require_job(job_id)
                job["current_prompt_id"] = prompt_id
                job["updated_at"] = _utc_now()
                self._write_job(job)
        history = self.comfyui.wait_for_history(
            prompt_id,
            timeout=self.config.job_timeout_seconds,
            poll_seconds=self.config.poll_seconds,
            canceled=lambda: self._cancel_requested(job_id),
        )
        return self.comfyui.download_output(history)

    def _schedule_if_needed(self, job_id: str, job: dict[str, Any]) -> None:
        if job.get("status") not in {"queued", "running"} or job_id in self._scheduled:
            return
        self._scheduled.add(job_id)
        self.executor.submit(self._run_job, job_id)

    def _run_job(self, job_id: str) -> None:
        try:
            with self._lock:
                job = self._require_job(job_id)
                if job.get("cancel_requested"):
                    raise ProviderJobCanceled("provider job canceled")
                job["status"] = "running"
                if self._is_h3_job(job):
                    self._cancel_idle_unload_locked()
                job.setdefault("started_at", _utc_now())
                job["updated_at"] = _utc_now()
                self._write_job(job)
            request = job["request"]
            generation_spec = request["generation_spec"]
            profile = self.config.profiles[str(generation_spec["profile"])]
            parameters = request.get("runtime_parameters") or generation_spec["parameters"]
            source_artifacts = request.get("source_artifacts") or []
            if job.get("current_prompt_id") and profile.adapter in {
                *COMFYUI_H3_ADAPTER_KINDS,
                COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND,
            }:
                self._active_comfyui_transformer = (
                    profile.checkpoint
                    if profile.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND
                    else profile.transformer
                )
            else:
                self._ensure_comfyui_transformer(profile)
            source_path: Path | None = None
            first_frame_ref = ""
            source_video_ref = ""
            reference_video_refs: list[str] = []
            reference_image_refs: list[str] = []
            reference_roles: list[str] = []
            for source_index, source in enumerate(source_artifacts):
                source_content = base64.b64decode(source["content_base64"], validate=True)
                source_suffix = {
                    "image/jpeg": ".jpg",
                    "image/png": ".png",
                    "image/webp": ".webp",
                    "video/mp4": ".mp4",
                    "video/webm": ".webm",
                    "video/quicktime": ".mov",
                }.get(source["content_type"], ".bin")
                source_filename = (
                    f"{source_index + 1:02d}_"
                    + _safe_name(Path(str(source["name"])).stem)
                    + source_suffix
                )
                artifact_path = self._job_dir(job_id) / "inputs" / source_filename
                artifact_path.parent.mkdir(parents=True, exist_ok=True)
                artifact_path.write_bytes(source_content)
                default_role = (
                    "reference"
                    if profile.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND
                    else ("first_frame" if source_index == 0 else "subject")
                )
                role = str(source.get("role") or default_role)
                if role == "first_frame":
                    source_path = artifact_path
                if profile.adapter in {
                    COMFYUI_WAN22_ADAPTER_KIND,
                    COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND,
                    *COMFYUI_H3_ADAPTER_KINDS,
                }:
                    if self.comfyui is None:
                        raise ProviderJobError(
                            "comfyui_unavailable",
                            "platform generation backend is unavailable",
                        )
                    uploaded_ref = self.comfyui.upload_input(
                        source_content,
                        source_filename,
                        f"ydc_generated_media/{job_id}",
                    )
                    if role == "first_frame":
                        first_frame_ref = uploaded_ref
                    elif role == "source_video":
                        source_video_ref = uploaded_ref
                    elif role == "reference_video":
                        reference_video_refs.append(uploaded_ref)
                    else:
                        reference_image_refs.append(uploaded_ref)
                        reference_roles.append(role)
            existing_counts: dict[str, int] = {}
            for sample in job.get("samples") or []:
                existing_counts[str(sample["label"])] = existing_counts.get(str(sample["label"]), 0) + 1
            planned: list[tuple[str, int]] = []
            for label, count in request["deficits"].items():
                for index in range(existing_counts.get(label, 0), count):
                    planned.append((label, index))
                    if len(planned) + len(job.get("samples") or []) >= request["max_outputs"]:
                        break
                if len(planned) + len(job.get("samples") or []) >= request["max_outputs"]:
                    break
            for label, index in planned:
                if self._cancel_requested(job_id):
                    raise ProviderJobCanceled("provider job canceled")
                sample_hash = hashlib.sha256(f"{job_id}:{label}:{index}".encode()).hexdigest()
                sample_id = "gms_" + sample_hash[:32]
                configured_seed = parameters.get("seed")
                seed = int(configured_seed) + index if configured_seed is not None else int(sample_hash[:16], 16)
                if profile.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND:
                    if self.comfyui is None:
                        raise ProviderJobError(
                            "comfyui_unavailable",
                            "platform HiDream image backend is unavailable",
                        )
                    prompt = _build_comfyui_hidream_o1_image_prompt(
                        profile,
                        reference_image_refs=reference_image_refs,
                        positive=str(parameters["behavior_prompts"][label]),
                        negative=str(parameters["negative_prompt"]),
                        width=int(parameters["width"]),
                        height=int(parameters["height"]),
                        seed=seed,
                        filename_prefix=f"ydc_generated_media/{job_id}/{sample_id}",
                        steps=int(parameters["steps"]),
                        cfg=float(parameters["cfg"]),
                    )
                    content = self._run_or_resume_comfyui_prompt(job_id, prompt)
                elif profile.adapter == INLINE_CORE_H3_ADAPTER_KIND:
                    if self.inline_core is None:
                        raise ProviderJobError(
                            "inline_core_unavailable", "platform H3 generation backend is unavailable"
                        )
                    run_id = self.inline_core.queue_i2v(
                        profile,
                        image_path=source_path,
                        prompt=str(parameters["behavior_prompts"][label]),
                        width=int(parameters["width"]),
                        height=int(parameters["height"]),
                        length=int(parameters["length"]),
                        fps=float(parameters["fps"]),
                        steps=int(parameters["steps"]),
                        seed=seed,
                    )
                    with self._lock:
                        job = self._require_job(job_id)
                        job["current_run_id"] = run_id
                        job["updated_at"] = _utc_now()
                        self._write_job(job)
                    content = self.inline_core.wait_for_output(
                        run_id,
                        timeout=self.config.job_timeout_seconds,
                        poll_seconds=self.config.poll_seconds,
                        canceled=lambda: self._cancel_requested(job_id),
                    )
                elif profile.adapter == COMFYUI_H3_REF2VA_ADAPTER_KIND:
                    if self.comfyui is None:
                        raise ProviderJobError(
                            "comfyui_unavailable", "platform H3 generation backend is unavailable"
                        )
                    if not source_video_ref:
                        raise ProviderJobError(
                            "source_artifacts_required", "Ref2VA source video is required"
                        )
                    if reference_video_refs:
                        LOGGER.info(
                            "Ref2VA job %s supplied %d additional reference videos",
                            job_id,
                            len(reference_video_refs),
                        )
                    prompt = _build_comfyui_h3_ref2va_prompt(
                        profile,
                        source_video_ref=source_video_ref,
                        reference_video_refs=reference_video_refs,
                        reference_image_refs=reference_image_refs,
                        reference_roles=reference_roles,
                        positive=str(parameters["behavior_prompts"][label]),
                        width=int(parameters["width"]),
                        height=int(parameters["height"]),
                        length=int(parameters["length"]),
                        seed=seed,
                        filename_prefix=f"ydc_generated_media/{job_id}/{sample_id}",
                        steps=int(parameters["steps"]),
                        fps=float(parameters["fps"]),
                        preserve_source_audio=bool(parameters["preserve_source_audio"]),
                    )
                    content = self._run_or_resume_comfyui_prompt(job_id, prompt)
                elif profile.adapter == COMFYUI_H3_OFFICIAL_I2V_ADAPTER_KIND:
                    if self.comfyui is None:
                        raise ProviderJobError(
                            "comfyui_unavailable", "platform H3 generation backend is unavailable"
                        )
                    prompt = _build_comfyui_h3_official_i2v_prompt(
                        profile,
                        first_frame_ref=first_frame_ref,
                        reference_image_refs=reference_image_refs,
                        positive=str(parameters["behavior_prompts"][label]),
                        width=int(parameters["width"]),
                        height=int(parameters["height"]),
                        length=int(parameters["length"]),
                        seed=seed,
                        filename_prefix=f"ydc_generated_media/{job_id}/{sample_id}",
                        steps=int(parameters["steps"]),
                        fps=float(parameters["fps"]),
                    )
                    content = self._run_or_resume_comfyui_prompt(job_id, prompt)
                elif profile.adapter == COMFYUI_H3_ADAPTER_KIND:
                    if self.comfyui is None:
                        raise ProviderJobError(
                            "comfyui_unavailable", "platform H3 generation backend is unavailable"
                        )
                    prompt = _build_comfyui_h3_prompt(
                        profile,
                        first_frame_ref=first_frame_ref,
                        reference_image_refs=reference_image_refs,
                        reference_roles=reference_roles,
                        positive=str(parameters["behavior_prompts"][label]),
                        width=int(parameters["width"]),
                        height=int(parameters["height"]),
                        length=int(parameters["length"]),
                        seed=seed,
                        filename_prefix=f"ydc_generated_media/{job_id}/{sample_id}",
                        steps=int(parameters["steps"]),
                        fps=float(parameters["fps"]),
                    )
                    content = self._run_or_resume_comfyui_prompt(job_id, prompt)
                else:
                    if self.comfyui is None:
                        raise ProviderJobError(
                            "comfyui_unavailable", "platform generation backend is unavailable"
                        )
                    prompt = _build_wan22_prompt(
                        profile,
                        image_ref=first_frame_ref,
                        positive=str(parameters["behavior_prompts"][label]),
                        negative=str(parameters["negative_prompt"]),
                        width=int(parameters["width"]),
                        height=int(parameters["height"]),
                        length=int(parameters["length"]),
                        seed=seed,
                        filename_prefix=f"ydc_generated_media/{job_id}/{sample_id}",
                        steps=int(parameters["steps"]),
                        cfg=float(parameters["cfg"]),
                        fps=float(parameters["fps"]),
                    )
                    content = self._run_or_resume_comfyui_prompt(job_id, prompt)
                is_image_output = (
                    profile.adapter == COMFYUI_HIDREAM_O1_IMAGE_ADAPTER_KIND
                )
                extension = "png" if is_image_output else "mp4"
                content_type = "image/png" if is_image_output else "video/mp4"
                contract = IMAGE_SAMPLE_CONTRACT if is_image_output else SAMPLE_CONTRACT
                relative_path = f"samples/{sample_id}/{sample_id}.{extension}"
                destination = self._job_dir(job_id) / relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
                with self._lock:
                    job = self._require_job(job_id)
                    job.setdefault("samples", []).append(
                        {
                            "sample_id": sample_id,
                            "label": label,
                            "filename": f"{sample_id}.{extension}",
                            "checksum": _checksum(content),
                            "content_type": content_type,
                            "contract": contract,
                            "storage_path": relative_path,
                        }
                    )
                    job.pop("current_prompt_id", None)
                    job.pop("current_run_id", None)
                    job["updated_at"] = _utc_now()
                    self._write_job(job)
            with self._lock:
                job = self._require_job(job_id)
                if job.get("cancel_requested"):
                    raise ProviderJobCanceled("provider job canceled")
                if not job.get("samples"):
                    raise ProviderJobError("provider_output_missing", "generated-media provider produced no samples")
                job["status"] = "succeeded"
                job["finished_at"] = _utc_now()
                job["updated_at"] = job["finished_at"]
                job.pop("current_prompt_id", None)
                job.pop("current_run_id", None)
                self._write_job(job)
        except ProviderJobCanceled:
            with self._lock:
                job = self._require_job(job_id)
                job["status"] = "canceled"
                job["finished_at"] = _utc_now()
                job["updated_at"] = job["finished_at"]
                job.pop("current_prompt_id", None)
                job.pop("current_run_id", None)
                self._write_job(job)
        except ProviderJobError as exc:
            LOGGER.exception("generated-media provider job failed code=%s", exc.code)
            self._fail_job(
                job_id,
                exc.code,
                exc.safe_message,
                failure_stage=exc.failure_stage,
                retryable=exc.retryable,
            )
        except Exception:
            LOGGER.exception("generated-media provider job failed unexpectedly")
            self._fail_job(
                job_id,
                "provider_internal_error",
                "generated-media provider job failed",
                failure_stage="provider_execution",
                retryable=True,
            )
        finally:
            with self._lock:
                self._scheduled.discard(job_id)
                job = self._read_job(job_id)
                if job is not None and self._is_h3_job(job):
                    self._arm_idle_unload_locked(reset_deadline=True)

    def _fail_job(
        self,
        job_id: str,
        code: str,
        message: str,
        *,
        failure_stage: str,
        retryable: bool,
    ) -> None:
        with self._lock:
            job = self._require_job(job_id)
            job["status"] = "failed"
            job["failure_stage"] = failure_stage
            job["error_code"] = code
            job["error_message"] = message
            job["retryable"] = retryable
            job["finished_at"] = _utc_now()
            job["updated_at"] = job["finished_at"]
            job.pop("current_prompt_id", None)
            job.pop("current_run_id", None)
            self._write_job(job)

    def _cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            job = self._read_job(job_id)
            return bool(job is None or job.get("cancel_requested"))

    def _job_dir(self, job_id: str) -> Path:
        if not re.fullmatch(r"gmjob_[a-f0-9]{32}", job_id):
            raise ProviderJobError("job_not_found", "generated-media job was not found")
        return self.config.state_root / job_id

    def _read_job(self, job_id: str) -> dict[str, Any] | None:
        path = self._job_dir(job_id) / "job.json"
        if not path.is_file():
            return None
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None

    def _require_job(self, job_id: str) -> dict[str, Any]:
        job = self._read_job(job_id)
        if job is None:
            raise ProviderJobError("job_not_found", "generated-media job was not found")
        return job

    def _write_job(self, job: dict[str, Any]) -> None:
        job_dir = self._job_dir(str(job["job_id"]))
        job_dir.mkdir(parents=True, exist_ok=True)
        path = job_dir / "job.json"
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(job, sort_keys=True), encoding="utf-8")
        os.replace(temporary, path)


def _safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._") or "source"


@lru_cache(maxsize=1)
def _default_service() -> ProviderService:
    return ProviderService(ProviderConfig.from_environment())


def _provider_error_detail(
    service: ProviderService,
    error: ProviderJobError,
) -> dict[str, Any]:
    return {
        "code": error.code,
        "error_code": error.code,
        "message": error.safe_message,
        "failure_stage": error.failure_stage,
        "retryable": error.retryable,
        "provider_diagnostics": {
            "provider_version": service.config.provider_version,
        },
    }


def create_app(service: ProviderService | None = None) -> FastAPI:
    provider = FastAPI(title="YDC Generated Media Provider", version="1.0")

    def resolved_service() -> ProviderService:
        return service or _default_service()

    def authorize(request: FastApiRequest, current: ProviderService) -> None:
        header = request.headers.get("authorization", "")
        scheme, _, supplied = header.partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(supplied, current.config.token()):
            raise HTTPException(status_code=401, detail={"code": "provider_unauthorized", "message": "provider authorization is required"})

    @provider.get("/healthz")
    def health(request: FastApiRequest) -> dict[str, Any]:
        current = resolved_service()
        authorize(request, current)
        try:
            return current.healthcheck()
        except ProviderJobError as exc:
            raise HTTPException(
                status_code=503,
                detail=_provider_error_detail(current, exc),
            ) from None

    @provider.post("/v1/generated-media/jobs")
    async def create_job(request: FastApiRequest) -> dict[str, Any]:
        current = resolved_service()
        authorize(request, current)
        try:
            return current.submit(await request.json())
        except ProviderJobError as exc:
            status = 409 if exc.code == "immutable_job_conflict" else 422
            raise HTTPException(
                status_code=status,
                detail=_provider_error_detail(current, exc),
            ) from None

    @provider.get("/v1/generated-media/jobs/{job_id}")
    def get_job(job_id: str, request: FastApiRequest) -> dict[str, Any]:
        current = resolved_service()
        authorize(request, current)
        try:
            return current.get(job_id)
        except ProviderJobError as exc:
            status = 404 if exc.code == "job_not_found" else 409
            raise HTTPException(
                status_code=status,
                detail=_provider_error_detail(current, exc),
            ) from None

    @provider.get("/v1/generated-media/resources")
    def resources(request: FastApiRequest) -> dict[str, Any]:
        current = resolved_service()
        authorize(request, current)
        return current.resource_lifecycle()

    @provider.post("/v1/generated-media/resources:unload")
    def unload_resources(request: FastApiRequest) -> dict[str, Any]:
        current = resolved_service()
        authorize(request, current)
        try:
            return current.unload_inline_core()
        except ProviderJobError as exc:
            status = 409 if exc.code == "provider_resource_busy" else 503
            raise HTTPException(
                status_code=status,
                detail=_provider_error_detail(current, exc),
            ) from None

    @provider.post("/v1/generated-media/jobs/{job_id}:cancel")
    def cancel_job(job_id: str, request: FastApiRequest) -> dict[str, Any]:
        current = resolved_service()
        authorize(request, current)
        try:
            return current.cancel(job_id)
        except ProviderJobError as exc:
            status = 404 if exc.code == "job_not_found" else 409
            raise HTTPException(
                status_code=status,
                detail=_provider_error_detail(current, exc),
            ) from None

    return provider


app = create_app()
