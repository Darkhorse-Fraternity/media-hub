---
name: media-hub-video
description: Generate or edit videos in this Media Hub project through its Agent API. Use when the user wants an H3 video job, a Ref2VA edit of a completed video, or the resulting job/video checked or downloaded.
---

# Media Hub video

Use the project's Agent API at `https://media-hub.test-xm.pumpkii.click:8880`. The live [OpenAPI document](https://media-hub.test-xm.pumpkii.click:8880/api/openapi) currently advertises a server URL without `:8880`; use the verified URL above. Check the live document when an endpoint or payload is uncertain.

Run `python3 .Codex/skills/media-hub-video/scripts/media_hub_video.py --help` for the available commands. The helper reads `MEDIA_HUB_AGENT_TOKEN` or the macOS Keychain item with service `media-hub-agent-api` and account `media-hub-agent`. Never put the token in a command argument, payload file, skill file, or response.

On this Codex host, reading the Keychain and calling the live API may require an escalated tool execution. Request that execution for the helper when the sandbox denies access; do not copy the token into a command as a workaround.

## Generate

1. Read [references/api.md](references/api.md) for payload and upload rules. Call `profiles` before choosing a workflow. The current admin default is `platform-h3-i2v-official-base-v1`; profile capabilities can change.
2. For an explicitly numbered shot plan, use a structured video script. Find an existing script with `scripts` and `script ID`, or create one with `create-script PAYLOAD.json`. Queue its shots with `generate-shots SCRIPT_ID PAYLOAD.json`. Media Hub automatically concatenates the latest successful video for every shot into one `assemble` job. If all shots succeeded but no assembly appears, call `assemble SCRIPT_ID`. To combine existing successful standalone jobs in script order, pass one `--source-job-id ID` per shot. Present, download, and publish the assembly job as the final video; treat shot jobs as intermediate assets.
3. For a single continuous brief, write the prompt and JSON payload to a local file and call `generate PAYLOAD.json`. A 30-second generation is internally split into two H3 segments; the first segment's final frame is passed into the second to improve visual continuity. It returns one generation job and one final MP4, though continuity is not guaranteed. If a first frame or visual reference is required, upload the user's image with `upload` and use the returned `storage_key`. Do not invent storage keys. Use the `h3-prompt-writing` skill for substantial H3 prompt writing.
4. For an already assembled script video with an awkward cut, call `assemble SCRIPT_ID --source-job-id FIRST --source-job-id SECOND --transition fade_white --rebuild` to replace the same draft's MP4 while keeping its history entry and URL. Use `fade_black` for darker material. Rebuild is blocked after the publishing draft has entered review or gained publish targets.
5. Save the returned job ID and use `job ID` to check status. Once the final job succeeds, use `video ID OUTPUT.mp4` to download a local MP4 for review. Do not represent a queued or running job as a completed video.

## Modify

1. Call `job SOURCE_ID` and verify the source video succeeded. Identify the exact ranges and desired changes with the user or existing brief.
2. Follow [references/api.md](references/api.md) for Ref2VA edit segments. Submit `edit SOURCE_ID PAYLOAD.json`; this creates a new job and preserves the source audio by default.
3. Check the new job and download its MP4 after success. Keep the source job ID and edited job ID distinct.

## Failures and retries

Report `error_code`, `failure_stage`, and `error_retryable` from the job. `waiting_for_gpu` means queued for GPU access; it is not generation progress. Retry only after the cause has been addressed or when the user requests it, and avoid duplicate jobs. Do not delete jobs or publish videos as part of generation or editing unless separately requested.
