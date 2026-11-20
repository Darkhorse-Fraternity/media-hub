---
name: media-hub-video
description: Generate or edit Media Hub videos through its Agent API, including still-image guidance from white-model layouts and explicitly requested motion references. Use for video jobs, script-shot references, uploads, status, downloads, and edits. Use previs-workbench for white-model scene management.
---

# Media Hub video

Use the project's Agent API at `https://media-hub.test-xm.pumpkii.click:8880`. API 1.9 and the correct public server URL were verified in the live [OpenAPI document](https://media-hub.test-xm.pumpkii.click:8880/api/openapi) on 2026-10-15. Check the live document when an endpoint or payload is uncertain.

The repository adds white-model artifact references in API `1.12.0`; these were verified locally, not on that deployment. Confirm its live OpenAPI before using the new endpoints or fields. For reusable scenes, groups, thumbnails, introductions and versioned white-model edits, use the project [previs-workbench skill](../previs-workbench/SKILL.md).

Run `python3 .Codex/skills/media-hub-video/scripts/media_hub_video.py --help` for the available commands. Use the `server@growup.com` Agent credential: the helper reads only `MEDIA_HUB_SERVER_AGENT_TOKEN`, then the macOS Keychain service `media-hub-agent-token-server-growup` for the current OS user through `scripts/read-server-token.swift`. Do not fall back to shared/admin credentials. Never put the token in a command argument, payload file, skill file, or response.

On this Codex host, reading the Keychain and calling the live API may require an escalated tool execution. A failed sandbox Keychain query, including exit 44, cannot establish that the credential is absent. Retry the helper in the authorized host context before asking for credential configuration; do not copy the token into a command as a workaround. Keychains are host-specific.

## Generate

1. Read [references/api.md](references/api.md) for payload and upload rules. Call `profiles` before choosing a workflow. Use the profile list to confirm the admin default and whether HyperFlow H3 Flash GGUF (`platform-h3-hyperflow-flash-gguf-v1`) is available.
2. For a numbered shot plan, use a structured video script. Find it with `scripts` and `script ID`, or create it with `create-script PAYLOAD.json`. Queue shots with `generate-shots SCRIPT_ID PAYLOAD.json`. When `continuity_mode` is omitted, Flash generates independent shots and a profile with `supportsNativeAVContinuation: true` uses native continuation. For a brief that requires continuity, explicitly select a profile with that capability and set `continuity_mode: native_av`. Use 15-second shots by default and retain native H3 dialogue. A 15-second continuation reserves 22 context frames and requires the 396-frame Provider limit. Do not substitute system TTS or infer voice locking from speaker IDs. Media Hub automatically concatenates the latest successful video for each shot into an `assemble` job. If all shots succeeded without an assembly, call `assemble SCRIPT_ID`. To combine standalone jobs in script order, pass one `--source-job-id ID` per shot. Deliver the assembled video. Publish only when separately requested.
3. For a single continuous brief, write the prompt and JSON payload to a local file and call `generate PAYLOAD.json`. A 30-second generation is internally split into two H3 segments; the first segment's final frame is passed into the second to improve visual continuity. It returns one generation job and one final MP4, though continuity is not guaranteed. If a first frame or visual reference is required, upload the user's image with `upload` and use the returned `storage_key`. Do not invent storage keys. Use the `h3-prompt-writing` skill for substantial H3 prompt writing.
4. For an already assembled script video with an awkward cut, call `assemble SCRIPT_ID --source-job-id FIRST --source-job-id SECOND --transition fade_white --rebuild` to replace the same draft's MP4 while keeping its history entry and URL. Use `fade_black` for darker material. Rebuild is blocked after the publishing draft has entered review or gained publish targets.
5. Save the returned job ID and use `job ID` to check status. Follow the [output review](references/api.md#output-review) before delivering a video or selecting a take for assembly.

## Generate from white-model/previs

- **Default to still-image guidance for composition and placement.** Use the white model to read the framing, viewpoint, and relative positions. If an original photograph already matches the intended opening, use that image directly. Otherwise, use a white-model still as a layout reference for a photorealistic still-image generation or edit. Use any applicable original imagery to guide appearance. Review the finished still for framing, subject placement, lighting, and real materials before submitting the video. H3 anchors the opening to the supplied first frame and can carry its proxy textures throughout the shot.
- **Send the selected photograph or finished still as the opening image.** Use `generation_mode: base` and `first_frame`, or set `first_frame_asset_id` for a director shot. Omit `reference_video` and `reference_artifact_id` for a new image-guided job. When converting a shot that already has a video reference, verify that selecting the new still clears the pinned video. Describe new camera and subject movement in the prompt. Check `maxReferenceImages` before sending any additional subject or style images. After generation, check opening, middle and ending frames for the requested look and layout.
- **Use a motion clip only when requested and allowed.** When the user asks to reproduce timing, a camera path, a subject trajectory, or changing occlusion from the preview itself and permits video input, use [previs-workbench](../previs-workbench/SKILL.md) to render and inspect the relevant interval. Check `supportsReferenceVideo: true` via `profiles`. Follow the [reference generation contract](references/api.md#whole-video-reference-generation) to attach one clip of up to 124 frames at 24 FPS. Set the output duration independently. Use `<Picture 1>` for the first appearance image in the six-field prompt and verify that each tag maps to an actual input.

For a new batch that repeats the same workflow, review one representative take before submitting the rest unless the user has asked to queue the batch together. Keep the reference artifact/revision or source checksum, prompt, seed and workflow/model versions when evaluating a motion-reference take.

## Mix ordinary and previs shots

Use one script as the ordered shot plan. Use `first_frame_asset_id` for still guidance. On deployments with the white-model artifact API, use `reference_artifact_id` for shots that need a motion reference. These fields are mutually exclusive. When the batch includes motion-reference shots, call `generate-shots` with `continuity_mode: independent` and optionally `shot_ids`. A mixed request's `generation_profile` controls the base shots. A reference-only request can omit it to use the configured reference workflow. Assemble reviewed takes through the normal script flow.

For external clips or an older deployment without artifact references, retain the standalone upload/reference workflow and attach successful takes with `assemble SCRIPT_ID --source-job-id JOB_1 --source-job-id JOB_2` in script order. The Crucible white-model worker currently uses CPU/Chromium.

Example: ordinary opening → previs-controlled interaction → ordinary ending. Review shared character appearance, lighting, action endpoints and soundtrack across cuts. The current reference path supplies proxy motion and new native audio; it does not inherit a preceding shot's native AV context. Do not claim speaker continuity solely because clips were concatenated.

## Modify

1. Call `job SOURCE_ID` and verify the source video succeeded. Identify the exact ranges and desired changes with the user or existing brief.
2. Follow [references/api.md](references/api.md) for Ref2VA edit segments. Submit `edit SOURCE_ID PAYLOAD.json`; this creates a new job and preserves the source audio by default.
3. Check the new job and download its MP4 after success. Keep the source job ID and edited job ID distinct.

## Failures and retries

For active jobs, read `queue.phase`, `queue.aheadSegments`, `queue.blockingPhase`, and `queue.segmentIndex` out of `queue.segmentCount` to explain what the job is waiting for. See [queue fields](references/api.md#job-lifecycle). For failed jobs, report `error_code`, `failure_stage`, and `error_retryable`. Retry only after the cause has been addressed or when the user requests it, and avoid duplicate jobs. Do not delete jobs or publish videos as part of generation or editing unless separately requested.
