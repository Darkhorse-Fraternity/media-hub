# Agent API details

Source of truth: `GET https://media-hub.test-xm.pumpkii.click:8880/api/openapi` (OpenAPI 3.1, observed version 1.7.0 on 2026-09-27). Authenticated requests use `Authorization: Bearer <token>`. The helper in `../scripts/media_hub_video.py` supplies that header without printing the token.

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

## Job lifecycle

`GET /api/v1/generations/{jobId}` returns the current job. Typical states: `scheduled`, `queued`, `waiting_for_gpu`, `running`, `succeeded`, `failed`, `canceled`. `GET /api/v1/generations/{jobId}/video` returns MP4 only after success. `POST /api/v1/generations/{jobId}/retry` queues an eligible failed job for retry. Avoid repeated retries while a GPU or Provider problem remains.

## Multi-shot complete video

`GET /api/v1/scripts` and `GET /api/v1/scripts/{scriptId}` expose the structured script, ordered shots, `shotJobs`, and `assembledJob`. `POST /api/v1/scripts` creates a script with `title`, `brief`, and up to 12 ordered `shots`; each shot needs `title`, `duration_seconds` (5–15), and `visual_description`. `POST /api/v1/scripts/{scriptId}/generate` accepts `{}` for every shot or `shot_ids` for a subset. Successful shots are automatically concatenated into a single `assemble` generation job after every latest shot succeeds. `POST /api/v1/scripts/{scriptId}/assemble` can request the same deterministic assembly when ready and returns 412 while any shot is still active or lacks a latest successful video.

The complete assembly job has `kind: "assemble"`, `scriptShotId: null`, an MP4, and a media task for platform publishing. Individual script-shot jobs are intermediate and must not be offered as publishable final videos. For `GET /api/v1/generations`, `whole_videos_only=true` removes those individual script-shot jobs from a final-video listing after the updated API is deployed.

After deployment of the native-continuation update, script generation also accepts
`continuity_mode: native_av | independent` (default `native_av`). Native mode
requires a profile with `supportsNativeAVContinuation: true`. Each later shot
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
