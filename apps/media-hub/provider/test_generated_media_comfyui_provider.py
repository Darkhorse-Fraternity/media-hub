from __future__ import annotations

import importlib.util
import sys
import threading
import types
import unittest
from pathlib import Path


class _DummyFastAPI:
    def __init__(self, **_: object) -> None:
        pass

    def get(self, *_: object, **__: object):
        return lambda function: function

    def post(self, *_: object, **__: object):
        return lambda function: function


fastapi = types.ModuleType("fastapi")
fastapi.FastAPI = _DummyFastAPI
fastapi.HTTPException = RuntimeError
fastapi.Request = object
sys.modules.setdefault("fastapi", fastapi)

MODULE_PATH = Path(__file__).with_name("generated_media_comfyui_provider.py")
SPEC = importlib.util.spec_from_file_location("media_hub_h3_provider", MODULE_PATH)
assert SPEC and SPEC.loader
provider = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = provider
SPEC.loader.exec_module(provider)


def ref2va_profile():
    return provider.ProviderProfile.from_mapping(
        "platform-h3-ref2va-edit-v1",
        {
            "adapter": provider.COMFYUI_H3_REF2VA_ADAPTER_KIND,
            "models": {
                "transformer": "ref2va.safetensors",
                "text_encoder": "clip.safetensors",
                "video_vae": "video-vae.safetensors",
                "audio_vae": "audio-vae.safetensors",
            },
            "defaults": {
                "width": 960,
                "height": 544,
                "length": 124,
                "fps": 24,
                "steps": 20,
                "cfg": 1,
            },
            "limits": {"max_width": 1344, "max_height": 1344, "max_length": 362},
        },
    )


class Ref2VAWorkflowTests(unittest.TestCase):
    def test_profile_does_not_require_fl2va_turbo_lora(self) -> None:
        profile = ref2va_profile()
        self.assertEqual(profile.transformer, "ref2va.safetensors")
        self.assertNotIn("MiniMaxH3TurboLoRA", profile.configured_models)

    def test_workflow_uses_native_ref2va_nodes_and_source_audio(self) -> None:
        workflow = provider._build_comfyui_h3_ref2va_prompt(
            ref2va_profile(),
            source_video_ref="job/source.mp4",
            reference_video_refs=[],
            reference_image_refs=["job/subject.png", "job/style.png"],
            reference_roles=["subject", "style"],
            positive="Replace the cup while keeping the camera motion.",
            width=960,
            height=544,
            length=124,
            seed=7,
            filename_prefix="test/ref2va",
            steps=20,
            fps=24,
            preserve_source_audio=True,
        )
        self.assertEqual(workflow["20"]["class_type"], "LoadVideo")
        self.assertEqual(workflow["30"]["class_type"], "MiniMaxH3ReferenceToVideo")
        self.assertEqual(workflow["42"]["inputs"]["sampler_name"], "res_multistep")
        conditioning = workflow["30"]["inputs"]
        self.assertEqual(conditioning["ref_videos.ref_video_0"], ["21", 0])
        self.assertEqual(conditioning["ref_video_audios.ref_video_audio_0"], ["21", 1])
        self.assertEqual(conditioning["ref_images.ref_image_0"], ["22", 0])
        self.assertEqual(conditioning["ref_images.ref_image_1"], ["23", 0])

    def test_workflow_can_omit_source_audio_conditioning(self) -> None:
        workflow = provider._build_comfyui_h3_ref2va_prompt(
            ref2va_profile(),
            source_video_ref="job/source.mp4",
            reference_video_refs=[],
            reference_image_refs=[],
            reference_roles=[],
            positive="Change the sky.",
            width=960,
            height=544,
            length=56,
            seed=8,
            filename_prefix="test/ref2va-muted",
            steps=20,
            fps=24,
            preserve_source_audio=False,
        )
        conditioning = workflow["30"]["inputs"]
        self.assertNotIn("ref_video_audios.ref_video_audio_0", conditioning)

    def test_provider_resumes_persisted_comfyui_prompt_after_restart(self) -> None:
        class FakeComfyUi:
            queue_calls = 0

            def prompt_exists(self, _prompt_id):
                return True

            def queue_prompt(self, _prompt, client_id):
                self.queue_calls += 1
                return f"new-{client_id}"

            def wait_for_history(self, prompt_id, **_):
                self.waited_for = prompt_id
                return {"outputs": {}}

            def download_output(self, _history):
                return b"video"

        service = object.__new__(provider.ProviderService)
        service.comfyui = FakeComfyUi()
        service.config = types.SimpleNamespace(
            job_timeout_seconds=60,
            poll_seconds=0.01,
        )
        service._lock = threading.RLock()
        job = {"current_prompt_id": "existing-prompt"}
        service._require_job = lambda _job_id: job
        service._write_job = lambda _job: None
        service._cancel_requested = lambda _job_id: False

        content = service._run_or_resume_comfyui_prompt("job-1", {"node": {}})

        self.assertEqual(content, b"video")
        self.assertEqual(service.comfyui.queue_calls, 0)
        self.assertEqual(service.comfyui.waited_for, "existing-prompt")


if __name__ == "__main__":
    unittest.main()
