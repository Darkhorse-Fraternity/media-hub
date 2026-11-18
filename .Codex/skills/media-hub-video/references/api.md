# Agent API details

Source of truth: `GET https://media-hub.test-xm.pumpkii.click:8880/api/openapi`. OpenAPI 3.1 / API 1.9 and authenticated reference-generation capabilities were verified live on 2026-10-15; recheck the live version before using newly added fields. Authenticated requests use `Authorization: Bearer <token>`. The helper in `../scripts/media_hub_video.py` supplies that header without printing the token.

Repository API `1.12.0` adds the reusable Crucible scene library and stored artifact references. These additions were verified locally and require deployment plus migrations `0028`–`0030`; they are not covered by the older live verification above. See [the white-model API workflow](../../../../docs/previs-scenes.md) and [previs-workbench](../../previs-workbench/SKILL.md) for scene/group CRUD, introductions, covers, immutable revisions, copying and asynchronous render APIs. The video helper passes generation/script JSON payloads through unchanged, including the artifact reference fields below; scene library operations use their REST endpoints directly.

## Generation

`POST /api/v1/generations` requires `prompt`. Useful optional fields: `title`, `language` (`zh` or `en`), `duration_seconds` (5–60, default 30), `quality_preset` (`fast`, `balanced`, `quality`), `generation_profile`, `seed`, `width`, `height`, `scheduled_at`, `first_frame`, `reference_images`, and `dialogues`. Dimensions must be multiples of 32 from 64 through 1344. A first frame has `storage_key`, `name`, and `content_type`. Reference images additionally need `role` (`style` or `subject`), up to four if the chosen profile supports them. Use `profiles` to check `maxReferenceImages` and `maxReferenceAudios` before setting references.

Example payload, with the user's actual prompt substituted:

```json
{
  "title": "A short video",
  "prompt": "A chronological visual description of the requested scene.",
  "language": "zh",
  "duration_seconds": 15,
  "quality_preset": "balanced"
}
```

For first-frame generation, add a `first_frame` object:

```json
{
  "storage_key": "key returned by upload",
  "name": "frame.png",
  "content_type": "image/png"
}
```

`POST /api/v1/prompts/optimize` accepts the generation shape and returns an optimized prompt without creating a generation job. Structured `dialogues` are authoritative; do not duplicate them as H3 `<d>` tags inside `prompt`.

`POST /api/v1/uploads/presign` accepts JPEG, PNG, or WebP images up to 5 MB. The helper's `upload IMAGE` sends `content_base64` so Media Hub stores the image server-side; it returns a `storage_key`. The presigned `upload_url` can be inaccessible from outside the deployment network.

## Editing

`POST /api/v1/generations/{sourceJobId}/edits` requires a succeeded source job and `segments`: one to four non-overlapping ranges within the source duration, each lasting 2–15 seconds. Each segment requires a unique `id`, `start_seconds`, `end_seconds`, and edit `prompt`; optional `reference_images` use the same storage-key shape as generation. The API creates a separate Ref2VA job and preserves source audio.

Example payload:

```json
{
  "title": "Change the middle shot",
  "language": "zh",
  "segments": [
    {
      "id": "middle",
      "start_seconds": 5,
      "end_seconds": 10,
      "prompt": "Describe only the visual change requested for this range."
    }
  ]
}
```

## Whole-video reference generation

Requires API 1.9 and an updated Provider advertising `supportsReferenceVideo: true`. `GET /api/v1/generation-profiles` returns `default_reference_generation_profile` and `reference_video_constraints`. Existing base profiles remain unchanged.

Upload MP4 via `upload-video FILE.mp4`, which sends server-side base64 content to `POST /api/v1/uploads/presign`; maximum 50 MB. Image uploads retain their 5 MB limit. Direct presigned PUT is available by omitting `content_base64`.

With the new white-model API, a successful owned MP4 rendered with `profile=h3_reference` can be used directly: set `reference_artifact_id` to its actual artifact UUID instead of `reference_video`. Never send both. Nominal duration and output aspect must match the saved artifact. The server probes the file and pins its artifact/revision IDs plus SHA-256; editing or archiving its source scene does not replace the task input. A scene ID, revision ID or render batch ID is not an artifact ID.

Submit to `POST /api/v1/generations`:

```json
{
  "generation_mode": "reference",
  "duration_seconds": 5,
  "width": 1344,
  "height": 768,
  "seed": 42,
  "prompt": "Replace this with a complete six-field reference-generation prompt.",
  "reference_video": {
    "storage_key": "Use the actual upload response",
    "name": "previs.mp4",
    "content_type": "video/mp4"
  },
  "reference_images": []
}
```

Use `h3-prompt-writing/references/reference-mode.md` for the prompt, including `summary: [reference generation]` and `<Video 1>`. Do not pass `first_frame`. The first reference image maps to `<Picture 1>` regardless of style/subject role. Standalone reference audio is unsupported. Proxy soundtrack is ignored; H3 generates native output sound.

The uploaded clip must be H.264/24 FPS, match output aspect, have dimensions from 64 to 1344, and contain exactly `min(362, ceil((ceil(duration_seconds*24)-5)/17)*17+5)` frames: nominal 5s → 124, 10s → 243, 15s → 362. The encoded duration therefore slightly exceeds the nominal duration. The server probes real media, verifies ownership and saves a SHA-256 snapshot; a changed reference file fails before Provider submission. A queued reference job's duration can only change when it still matches the saved frame count.

The job remains `kind: generate` and exposes reference metadata in `referenceVideo`; it uses normal queue, retry, result validation and download routes. Multiple shots can be assembled by explicitly passing successful job IDs to the script assembly API. Review the resulting take against the previs before accepting spatial fidelity.

## Job lifecycle

`GET /api/v1/generations/{jobId}` returns the current job. Typical states: `scheduled`, `queued`, `waiting_for_gpu`, `running`, `succeeded`, `failed`, `canceled`. `GET /api/v1/generations/{jobId}/video` returns MP4 only after success. `POST /api/v1/generations/{jobId}/retry` queues an eligible failed job for retry. Avoid repeated retries while a GPU or Provider problem remains.

## Multi-shot complete video

`GET /api/v1/scripts` and `GET /api/v1/scripts/{scriptId}` expose the structured script, ordered shots, `shotJobs`, and `assembledJob`. `POST /api/v1/scripts` creates a script with `title`, `brief`, and up to 12 ordered `shots`; each shot needs `title`, `duration_seconds` (5–15), and `visual_description`. `POST /api/v1/scripts/{scriptId}/generate` accepts `{}` for every shot or `shot_ids` for a subset. Successful shots are automatically concatenated into a single `assemble` generation job after every latest shot succeeds. `POST /api/v1/scripts/{scriptId}/assemble` can request the same deterministic assembly when ready and returns 412 while any shot is still active or lacks a latest successful video.

The complete assembly job has `kind: "assemble"`, `scriptShotId: null`, an MP4, and a media task for platform publishing. Individual script-shot jobs are intermediate and must not be offered as publishable final videos. For `GET /api/v1/generations`, `whole_videos_only=true` removes those individual script-shot jobs from a final-video listing after the updated API is deployed.

For a white-model-controlled shot, set `reference_artifact_id` to a successful H3 MP4 artifact. It is mutually exclusive with `first_frame_asset_id`; when patching a shot, omit a reference field to retain it or use null to clear it. A script can mix ordinary and reference shots with `continuity_mode: independent`. The service uses the configured reference profile for reference shots and the selected base profile for ordinary shots. A reference-only generation can omit `generation_profile` to use the configured reference default. White-model PNGs enter the existing image asset library through the render batch's `/image-assets` endpoint; use that asset ID as `first_frame_asset_id` for a first-frame shot.

Script generation accepts `continuity_mode: native_av | independent`. When
omitted, reference batches use independent shots and ordinary batches follow the
selected workflow’s capability. Native mode requires `supportsNativeAVContinuation: true`. Each later shot
waits for the preceding shot to pass validation, then receives its synchronized
22-frame audio-video tail through the official H3 guide node. Later authored
shots default to 15 seconds and must be no longer than 15 seconds. The official
Provider profile must allow 396 frames, including the context prefix and grid
alignment, to preserve the complete authored duration. For partial reruns the preceding shot
must be included or have an accepted take. Unsupported profiles fail preflight;
never quietly fall back to still-frame-only chaining or system TTS.

Script dialogue entries can include `voice` and
`delivery: on_screen | off_screen_voiceover`. These are native H3 directions,
not a voice identity guarantee. Confirm adjacent-shot voice and motion by
reviewing the actual generated result. `maxReferenceAudios: 0` describes
standalone audio artifacts and does not rule out synchronized AV continuation.
