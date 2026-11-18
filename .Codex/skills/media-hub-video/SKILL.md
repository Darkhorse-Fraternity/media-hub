---
name: media-hub-video
description: Generate or edit videos in this Media Hub project through its Agent API. Use when the user wants an H3 video job, a Ref2VA edit of a completed video, or the resulting job/video checked or downloaded.
---

# Media Hub video

Use the project's Agent API at `https://media-hub.test-xm.pumpkii.click:8880`. API 1.9 and the correct public server URL were verified in the live [OpenAPI document](https://media-hub.test-xm.pumpkii.click:8880/api/openapi) on 2026-10-15. Check the live document when an endpoint or payload is uncertain.

The repository adds white-model artifact references in API `1.12.0`; these were verified locally, not on that deployment. Confirm its live OpenAPI before using the new endpoints or fields. For reusable scenes, groups, thumbnails, introductions and versioned white-model edits, use the project [previs-workbench skill](../previs-workbench/SKILL.md).

Run `python3 .Codex/skills/media-hub-video/scripts/media_hub_video.py --help` for the available commands. The helper reads `MEDIA_HUB_AGENT_TOKEN` or the macOS Keychain item with service `media-hub-agent-api` and account `media-hub-agent`. Never put the token in a command argument, payload file, skill file, or response.

On this Codex host, reading the Keychain and calling the live API may require an escalated tool execution. Request that execution for the helper when the sandbox denies access; do not copy the token into a command as a workaround.

## Generate

1. Read [references/api.md](references/api.md) for payload and upload rules. Call `profiles` before choosing a workflow. Use the returned profile capabilities to confirm the current defaults.
2. For a numbered shot plan, use a structured video script. Find it with `scripts` and `script ID`, or create it with `create-script PAYLOAD.json`. Queue shots with `generate-shots SCRIPT_ID PAYLOAD.json`. When `continuity_mode` is omitted, reference batches use independent shots. For ordinary shots, the selected profile determines whether native continuation is available. For a brief that requires continuity, explicitly select a profile with that capability and set `continuity_mode: native_av`. Use 15-second shots by default and retain native H3 dialogue. A 15-second continuation reserves 22 context frames and requires the 396-frame Provider limit. Do not substitute system TTS or infer voice locking from speaker IDs. Media Hub automatically concatenates the latest successful video for each shot into an `assemble` job. If all shots succeeded without an assembly, call `assemble SCRIPT_ID`. To combine standalone jobs in script order, pass one `--source-job-id ID` per shot. Deliver the assembled video. Publish only when separately requested.
3. For a single continuous brief, write the prompt and JSON payload to a local file and call `generate PAYLOAD.json`. A 30-second generation is internally split into two H3 segments; the first segment's final frame is passed into the second to improve visual continuity. It returns one generation job and one final MP4, though continuity is not guaranteed. If a first frame or visual reference is required, upload the user's image with `upload` and use the returned `storage_key`. Do not invent storage keys. Use the `h3-prompt-writing` skill for substantial H3 prompt writing.
4. For an already assembled script video with an awkward cut, call `assemble SCRIPT_ID --source-job-id FIRST --source-job-id SECOND --transition fade_white --rebuild` to replace the same draft's MP4 while keeping its history entry and URL. Use `fade_black` for darker material. Rebuild is blocked after the publishing draft has entered review or gained publish targets.
5. Save the returned job ID and use `job ID` to check status. Once the final job succeeds, use `video ID OUTPUT.mp4` to download a local MP4 for review. Do not represent a queued or running job as a completed video.

## Generate from white-model/previs

1. Use [previs-workbench](../previs-workbench/SKILL.md) to find or fork a reusable Crucible scene, refine it and render a specific revision with `profile: h3_reference`. Inspect the resulting MP4 and retain its artifact/revision IDs. For a user-provided external or Blender clip, use the existing upload/normalization workflow. Follow the [reference generation contract](references/api.md#whole-video-reference-generation) for frame counts and payload fields.
2. Call `profiles` and verify the chosen profile advertises `supportsReferenceVideo: true`. The default reference profile uses the same Ref2VA model as editing, with separate generation behavior. An older Provider must fail with 412 instead of silently using I2V.
3. For a successful Media Hub white-model MP4, submit its `reference_artifact_id` directly; no re-upload is needed. For an external clip, use `upload-video PREVIS.mp4` and pass the returned `reference_video` instead. These fields are mutually exclusive. Upload appearance images with `upload IMAGE`. Write a six-field H3 reference prompt using `h3-prompt-writing`. Submit `generate PAYLOAD.json` with `generation_mode: reference` and an explicit `duration_seconds` from 5 to 15. No completed source job is required. Do not send `first_frame` or use the base prompt optimizer.
4. Check and download the new job normally. Review motion, occlusion and appearance against the saved white-model recipe/video, or the external clip's manifest. Preserve the source artifact/revision, checksum, prompt, seed and workflow/model versions. Scene edits and archival leave an existing generation's input fixed. Reference shots use independent generation without preceding-shot native AV continuation.

## Mix ordinary and previs shots

Use one script as the ordered shot plan. On deployments with the white-model artifact API, set `reference_artifact_id` on each previs-controlled shot; it is mutually exclusive with `first_frame_asset_id`. Ordinary shots can remain in the same script. Call `generate-shots` with `continuity_mode: independent` and optionally `shot_ids`. The service chooses the base workflow for ordinary shots and the reference workflow for white-model shots; a mixed request's `generation_profile` controls the ordinary shots. A reference-only request can omit it to use the configured reference workflow. Keep aspect, 24 FPS and nominal shot durations aligned with each reference. Assemble accepted shots through the normal script flow.

For external clips or an older deployment without artifact references, retain the standalone upload/reference workflow and attach successful takes with `assemble SCRIPT_ID --source-job-id JOB_1 --source-job-id JOB_2` in script order. The Crucible white-model worker currently uses CPU/Chromium.

Example: ordinary opening → previs-controlled interaction → ordinary ending. Review shared character appearance, lighting, action endpoints and soundtrack across cuts. The current reference path supplies proxy motion and new native audio; it does not inherit a preceding shot's native AV context. Do not claim speaker continuity solely because clips were concatenated.

## Modify

1. Call `job SOURCE_ID` and verify the source video succeeded. Identify the exact ranges and desired changes with the user or existing brief.
2. Follow [references/api.md](references/api.md) for Ref2VA edit segments. Submit `edit SOURCE_ID PAYLOAD.json`; this creates a new job and preserves the source audio by default.
3. Check the new job and download its MP4 after success. Keep the source job ID and edited job ID distinct.

## Failures and retries

Report `error_code`, `failure_stage`, and `error_retryable` from the job. `waiting_for_gpu` means queued for GPU access; it is not generation progress. Retry only after the cause has been addressed or when the user requests it, and avoid duplicate jobs. Do not delete jobs or publish videos as part of generation or editing unless separately requested.
