# Media Hub H3 Provider

## Whole-video reference generation

The Agent API supports `POST /api/v1/generations` with `generation_mode: reference`
and an uploaded `reference_video`. This creates a new video without a successful
source generation job. It reuses the configured `h3EditProfile` model; the Provider
advertises `supports_reference_video: true` separately from its legacy `kind: edit`
classification. Older Providers fail capability preflight.

The supplied Ref2VA profile selects PyTorch SDPA through ComfyUI's
`ModelAttentionBackend` node. This keeps long packed reference sequences off
the SageAttention FP8 path on Blackwell and scopes the change to Ref2VA.
Check the node is available before enabling the profile on an existing backend.

Media Hub accepts one H.264 MP4 (50 MB maximum), 24 FPS, matching output aspect,
with 56–124 frames on the 17n+5 grid, plus up to four appearance images. A job
can generate a 5–15 second shot from that short reference. The API probes media
before scheduling and persists its SHA-256 and dimensions in `reference_video`.
The worker checks that checksum again before submission.

Worker requests use `parameters.reference_mode: generation`,
`preserve_source_audio: false`, and artifact role `reference_video`. The whole
decoded sequence feeds `MiniMaxH3ReferenceToVideo`, alongside appearance images.
Mapping retains blocking, motion, camera and occlusion while replacing proxy
appearance. Existing edits omit the mode and continue requiring one `source_video`.

Apply migration `0026_h3_reference_generation`, deploy the updated Provider and
API/worker, then verify the advertised capability before submitting work. Use
`.Codex/skills/blender-previs` for scene rendering and
`.Codex/skills/media-hub-video` for API calls. Blender and FFmpeg are render
dependencies; FFprobe is needed by the API. Contract/graph tests do not establish
visual fidelity of a real H3 render, which still requires take review.

The 2026-10-15 production migration, verified capabilities, Blender installation,
and rollback locations are recorded in
[`docs/blender-previs-reference-deployment.md`](../../../docs/blender-previs-reference-deployment.md).

## Provider setup

This directory contains a Provider implementation for a GPU host. It supports
FL2VA video generation, Ref2VA video editing, and both MiniMax H3 Image and
HiDream-O1 for images.

- Provider source: `generated_media_comfyui_provider.py`
- Official Comfy-Org I2V baseline profile: `official-i2v-profile.json`
- Ref2VA profile fragment: `ref2va-profile.json`
- HyperFlow H3 Flash GGUF profile fragment: `hyperflow-profile.json`
- MiniMax H3 Image profile fragment: `h3-image-profile.json`
- HiDream profile fragment: `hidream-profile.json`
- GPU execution is serialized by the Provider's single-worker executor.
- Switching between FL2VA and Ref2VA unloads the active ComfyUI model before the
  next transformer is loaded.
- Ref2VA accepts one source video plus up to two additional reference videos and
  nine images. Media Hub currently submits one 2–15 second source clip and up to
  four per-segment style/subject images.
- The official I2V baseline uses `MiniMaxH3ImageToVideo`, the `simple`
  scheduler, and `res_multistep` sampling at a minimum of 20 steps. It supports
  an optional first frame but intentionally rejects extra reference images.

ComfyUI H3 video profiles use `websockets>=15,<17` to receive node and sampler
progress. Set `h3_step_timeout_seconds` in the Provider config to limit how
long a node or denoising step can go without advancing. The default is 600
seconds, measured after GPU admission. When the limit is reached, the Provider
stops the specific ComfyUI prompt and returns `comfyui_step_timeout` with the
node or sampler step. Each ComfyUI H3 video segment also has a 20-minute render
deadline anchored to its Provider start time after GPU admission, including
preparation. At that deadline the Provider stops the specific prompt and reports
`comfyui_render_timeout`. The deadline is carried across Provider restarts.

### Queue diagnostics

The authenticated `GET /v1/generated-media/queue` endpoint returns a snapshot
of the single worker's execution order. It uses the in-memory queue, including
jobs recovered on startup. Media Hub joins this snapshot with its current
Provider job IDs to report queue position and segment progress.

When merging into a deployment with a GPU Broker wrapper, keep the wrapper and
its release barrier. At worker entry, call
`_set_queue_phase(job_id, "gpu_admission")` before requesting a lease and return
early if it returns false. Set `processing` when the job enters its running
state and `gpu_cleanup` before the release barrier. Remove the entry in the
worker's final cleanup. This keeps the slot visible until the worker can admit
the next job.

### HyperFlow H3 Flash GGUF

Register `hyperflow-profile.json` in the Provider profiles and set
`hyperflow_comfyui_url` to a ComfyUI backend with native H3 support, ComfyUI-GGUF,
and ComfyUI-HyperFlow-Flash. Install the FL2VA Q4_K_M GGUF and the text encoder
and VAEs listed in the profile. On GPU Broker deployments, point the cleanup
barrier at the HyperFlow backend's own service unit. The Provider advertises
the workflow after verifying its nodes and model files.

The director's workflow menu lists `platform-h3-hyperflow-flash-gguf-v1`,
the default for new video generation. It uses independent shots with a text
prompt and an optional first frame. The
quality presets select 4, 6, or 8 steps. Use the Ref2VA or official I2V workflows
for whole-video references or synchronized shot continuation.

### Default image model

Image Studio and director first-frame requests create new jobs with
`platform-minimax-h3-image-v1`. Each job records its profile so retries
continue with the original model.

1. Prepare ComfyUI 0.45.0 or newer and install the four files listed in
   [ComfyUI's H3 Image guide](https://docs.comfy.org/tutorials/image/minimax/minimax-h3-image).
   The profile uses the INT8 image model and the 9B local prompt expander.
2. Register `h3-image-profile.json` with the Provider. If images need a newer
   ComfyUI than video, use a dedicated Provider with its own state directory and
   the same GPU Broker and Provider token. Set `MEDIA_HUB_H3_IMAGE_PROVIDER_URL`
   on the app to route H3 Image jobs to it.
3. Check that `/healthz` advertises `platform-minimax-h3-image-v1` with
   `kind: image`. Verify a 2K text-to-image job and a reference edit before
   deploying the app. After rollout, generate a first-frame candidate in the
   director and use it to start a test video shot.
4. To switch future image jobs back to HiDream, set
   `MEDIA_HUB_IMAGE_PROFILE=platform-hidream-o1-image-v1` on the app.
   Keep both Provider profiles available while jobs using them are queued or
   running.

## Director native audio-video continuation

The official I2V adapter accepts one `continuation_video` source artifact:
a synchronized 22-frame tail of the preceding accepted shot. It loads the clip
through `LoadVideo` / `GetVideoComponents` and connects both image frames and
audio to the official `MiniMaxH3AddGuide` at frame 0, using both VAEs. A separately
chosen next first frame is anchored at frame 22 rather than conflicting with the
context at frame 0. Sampling and native audio decoding remain the base 20-step
workflow; no system TTS or external voice service is involved.

The API waits for the predecessor to succeed, reserves 22 frames of generation
headroom in addition to the default 15-second authored shots, shifts dialogue
timestamps and removes the generated context prefix from both streams before
ASR and assembly. The director planner schedules actions and exact narration,
and treats slide images as factual source material unless their visual identity
was explicitly requested.

The official profile allows 396 frames: a 15-second continuation plus 22 context
frames, rounded up to H3's 17k+5 grid. The saved shot excludes the context and
alignment tail. This exceeds the node's documented 124–362 frame training range;
the node accepts longer lengths, but the 396-frame GPU quality needs separate
validation. Existing shorter-shot results do not establish that quality.

Requires a ComfyUI version exposing `MiniMaxH3AddGuide`. Health reports
`supports_native_av_continuation` only after that node is verified. Unsupported
profiles fail preflight rather than silently generating independent voices.
This is audio-video conditioning, not an absolute voice identity guarantee:
release acceptance still requires adjacent-shot listening, especially if the
tail contains silence or multiple speakers. Ordinary ASR verifies words, not
speaker identity. Use one recurring narrator and keep their final phrase audible
near the preceding shot's end.

The inspected 5090 checkout (`7d11ec31`) predates both the guide node and the
model's synchronized guide packing. `backport_native_av_guide.py` upgrades those
three source files from the official excerpts in `native-av-compat` while
preserving its existing quantization and attention code. Run it with
`--comfy-root PATH --backup-dir NEW_PATH --dry-run` first; it rejects a source
that differs from the expected baseline. Apply without `--dry-run` only after
the queue is idle. `verify_native_av_backend.py`, run from that ComfyUI checkout
with its Python, checks the guide rows and a small CPU H3 forward pass without
loading model weights. Restart ComfyUI and the Provider after verification.

Preserve deployment-specific GPU broker admission and release barriers when
applying Provider changes. The 2026-10-04 deployment used the native AV patch
against the inspected live Provider, rather than replacing those additions
with this repository's baseline. Keep the pre-update source and ComfyUI backups
for rollback. The excerpts retain ComfyUI's GPL-3.0 license.

Official references:

- https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native
- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py

Set `YDC_GENERATED_MEDIA_PROVIDER_CONFIG` to the local Provider configuration
path and run `generated_media_comfyui_provider.py` as the service entrypoint.
