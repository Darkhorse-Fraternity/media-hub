# Agent API details

Source of truth: `GET https://media-hub.test-xm.pumpkii.click:8880/api/openapi`. OpenAPI 3.1 / API 1.9 and authenticated reference-generation capabilities were verified live on 2026-10-15; recheck the live version before using newly added fields. Authenticated requests use `Authorization: Bearer <token>`. The helper in `../scripts/media_hub_video.py` supplies that header without printing the token.

Repository API `1.12.0` adds the reusable Crucible scene library and stored artifact references. These additions were verified locally and require deployment plus migrations `0028`–`0030`; they are not covered by the older live verification above. See [the white-model API workflow](../../../../docs/previs-scenes.md) and [previs-workbench](../../previs-workbench/SKILL.md) for scene/group CRUD, introductions, covers, immutable revisions, copying and asynchronous render APIs. The video helper passes generation/script JSON payloads through unchanged, including the artifact reference fields below; scene library operations use their REST endpoints directly.

## Generation

For white-model composition and subject placement, use the [still-image workflow](../SKILL.md#generate-from-white-modelprevis). Set `generation_mode: base` and `first_frame` to an original photo that fits the intended opening or a reviewed photorealistic still made from the layout. Omit `reference_video` and `reference_artifact_id`. Additional images are subject or style references within the selected profile's image limit. Verify the saved image-guided job has the expected `sourceImageContentType` and an empty `referenceVideo`.

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

Choose this mode only when the user requests motion from the supplied clip, such as a specific camera path, subject trajectory or timed occlusion, and permits video input. A camera move described as part of an image-guided shot can go in the base prompt. The output duration is set independently of the reference length.

Requires API 1.9 and an updated Provider advertising `supportsReferenceVideo: true`. `GET /api/v1/generation-profiles` returns `default_reference_generation_profile` and `reference_video_constraints`. Existing base profiles remain unchanged.

Upload MP4 via `upload-video FILE.mp4`, which sends server-side base64 content to `POST /api/v1/uploads/presign`; maximum 50 MB. Image uploads retain their 5 MB limit. Direct presigned PUT is available by omitting `content_base64`.

Use an owned, successful five-second MP4 rendered with `profile=h3_reference` by setting `reference_artifact_id` to its artifact UUID. Match the output aspect and choose the output duration independently. The server probes the file and pins its artifact and revision IDs plus SHA-256. Editing or archiving the source scene does not replace the task input.

Submit to `POST /api/v1/generations`:

```json
{
  "generation_mode": "reference",
  "duration_seconds": 15,
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

Use the [six-field H3 prompt contract](../../h3-prompt-writing/references/reference-mode.md), including `summary: [reference generation]` and `<Video 1>`. Number image tags as `<Picture 1>`, `<Picture 2>` and so on in the submitted `reference_images` order. Omit `first_frame` in this mode. H3 generates native output audio and ignores the proxy soundtrack. Standalone reference audio is unsupported.

The reference must be H.264 at 24 FPS, match output aspect, and have dimensions from 64 to 1344. Use 56, 73, 90, 107 or 124 frames on the `17n+5` grid. A nominal five-second clip has 124 frames (about 5.17 seconds). Longer clips are rejected before queuing. The output can be 5–15 seconds regardless of the reference length. The server probes the media, verifies ownership and saves a SHA-256 snapshot. A changed reference file fails before Provider submission.

The job remains `kind: generate` and exposes reference metadata in `referenceVideo`; it uses normal queue, retry, result validation and download routes. Multiple shots can be assembled by explicitly passing successful job IDs to the script assembly API. Review the resulting take against the previs before accepting spatial fidelity.

## Job lifecycle

`GET /api/v1/generations/{jobId}` returns the current job. Typical states: `scheduled`, `queued`, `waiting_for_gpu`, `running`, `succeeded`, `failed`, `canceled`. `GET /api/v1/generations/{jobId}/video` returns MP4 only after success. `POST /api/v1/generations/{jobId}/retry` queues an eligible failed job for retry. Avoid repeated retries while a GPU or Provider problem remains.

Use the active job's `queue` object from the list or detail endpoint to explain the wait. `phase: provider_queue` means the segment is waiting for the Provider's worker. `aheadSegments` counts earlier segments, including the one occupying the worker. `blockingPhase` distinguishes processing, GPU admission, and GPU cleanup when available. `phase: gpu_admission` means this segment is at the worker and requesting GPU access. Report `segmentIndex` (one-based) out of `segmentCount`. A null count or `provider_status_unavailable` means queue details are unavailable.

## Output review

Media Hub can return `output_validation_failed` for an undecodable video or a clip whose sampled frames are consistently blank or low-contrast gray texture. When delivering a video, open the authorized MP4 or extract frames from the start, middle and end. Check that the subject and scene are visible and the requested action and viewpoint are present. Check the audio when it is part of the brief. If the clip fails the brief, report the result with the job ID and stop before delivery, assembly, or automatic retries. If playback or frame extraction is unavailable, report that visual review is pending.

## Multi-shot complete video

`GET /api/v1/scripts` and `GET /api/v1/scripts/{scriptId}` expose the structured script, ordered shots, `shotJobs`, and `assembledJob`. `POST /api/v1/scripts` creates a script with `title`, `brief`, and up to 12 ordered `shots`; each shot needs `title`, `duration_seconds` (5–15), and `visual_description`. `POST /api/v1/scripts/{scriptId}/generate` accepts `{}` for every shot or `shot_ids` for a subset. Successful shots are automatically concatenated into a single `assemble` generation job after every latest shot succeeds. `POST /api/v1/scripts/{scriptId}/assemble` can request the same deterministic assembly when ready and returns 412 while any shot is still active or lacks a latest successful video.

The complete assembly job has `kind: "assemble"`, `scriptShotId: null`, an MP4, and a media task for platform publishing. Individual script-shot jobs are intermediate and must not be offered as publishable final videos. For `GET /api/v1/generations`, `whole_videos_only=true` removes those individual script-shot jobs from a final-video listing after the updated API is deployed.

For still guidance, set `first_frame_asset_id` to the original photo or finished still in the image library. The render batch's `/image-assets` endpoint imports a white-model PNG for preparing that still. For an explicitly requested motion-controlled shot, set `reference_artifact_id` to a successful H3 MP4 artifact. Setting a new image or video reference clears the other type. When patching without changing the input, omit both fields. To clear a reference explicitly, send null. A script can mix base and reference shots with `continuity_mode: independent`. A reference-only request can omit `generation_profile` to use the configured reference default.

Script generation accepts `continuity_mode: native_av | independent`. When
omitted, the selected profile determines the mode. HyperFlow H3 Flash GGUF
uses independent shots. Native mode requires `supportsNativeAVContinuation: true`. Each later shot
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
