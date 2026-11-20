---
name: blender-previs
description: Build or normalize existing Blender blocking animations for Media Hub H3 reference generation when Blender is explicitly required. Use previs-workbench for the current Crucible white-model scene library, groups, covers, introductions and reusable scene edits.
---

# Blender previs for H3

This is the existing Blender workflow. The current reusable white-model product uses Crucible; see [previs-workbench](../previs-workbench/SKILL.md) for that scene library and its APIs. This skill does not add .blend compatibility to the Crucible workbench.

Use Blender when the brief requires a Blender-authored view or motion. For a static composition or starting pose, select a rendered PNG and follow the [still guidance workflow](../media-hub-video/SKILL.md#generate-from-white-modelprevis). Use an MP4 when the requested action timing, camera path or changing occlusion must follow the animation.

## Build and inspect

1. Turn the brief into one scene per 5–15 second shot. Establish world coordinates, stable proxy IDs, distinct flat proxy colors, camera lens/path, and action keyframes. Keep dialogue and final appearance in the H3 brief.
2. Start from [assets/example.scene.json](assets/example.scene.json). Run `python3 .Codex/skills/blender-previs/scripts/previs.py plan SCENE.json` to validate and report the exact frame count. Put the last action keyframe at that reported frame. A nominal five-second export has 124 frames at 24 FPS. The planner can produce longer review animations that exceed the current reference upload limit.
3. Render with `python3 .Codex/skills/blender-previs/scripts/previs.py render SCENE.json OUTPUT_DIR`. Set `BLENDER_PATH` if Blender is not on PATH. This needs Blender and FFmpeg. It writes `previs.blend`, PNG frames, `previs.mp4`, and a manifest containing camera matrices and sampled screen-space proxy bounds. The manifest records geometry; it does not certify generated-video fidelity.
4. Inspect the animation and the five sampled frames before submission. Check left/right placement, near/far ordering, action endpoints, object count and intersections. Repair the Blender scene when the error already exists in the proxy animation. For articulated motion, author/rig the scene in Blender; the bundled primitive builder is a blocking scaffold.
5. For an existing Blender render, use `python3 .Codex/skills/blender-previs/scripts/previs.py normalize INPUT.mp4 OUTPUT.mp4 --duration 5 --width 1344 --height 768`. It converts to silent H.264/24 FPS with the required frame count and letterboxes to the output aspect. Review timing after normalization; short inputs repeat their last frame, long inputs are truncated.

## Render on 5090

Run `python3 .Codex/skills/blender-previs/scripts/previs.py render-remote SCENE.json OUTPUT_DIR`. It uses the existing SSH alias `5090`, uploads the scene and builder into a unique remote run directory, renders there, and downloads the blend file, PNG frames, MP4 and manifest. The downloaded MP4 must match the manifest checksum. Local Blender is not required. Override `--host` or `--blender-path` when using another configured render host.

The 5090 installation is `~/.local/opt/blender-4.5.13-linux-x64`, exposed through `~/.local/bin/blender`; FFmpeg and FFprobe are system executables. Remote artifacts remain under `~/.cache/media-hub/previs/run-*` for inspection and reruns. Complete needed previs renders before submitting H3 jobs. The helper rejects a busy GPU at preflight; this check does not reserve a GPU Broker lease, so it must not be treated as scheduling protection against other users' jobs.

## Generate and assess

Read the project `h3-prompt-writing` skill's [reference mode](../h3-prompt-writing/references/reference-mode.md) to bind proxy IDs to final subjects and images. Select and inspect the needed motion interval, then use the [video reference contract](../media-hub-video/references/api.md#whole-video-reference-generation) to submit a clip of up to 124 frames. Set the H3 output duration independently.

Choose previs per shot. A script may combine ordinary H3 shots with selected Ref2VA reference shots. Keep the same output dimensions/FPS and each authored shot's nominal duration, then assemble the accepted job IDs in script order. Use the mixed-shot workflow in `media-hub-video`; independently generated reference shots do not carry preceding-shot audio conditions.

Review output against the same sampled times: subject count, trajectory direction, relative position, occlusion, camera move, then final identity/style and native sound. Ref2VA conditions generation; it cannot guarantee exact coordinates or motion. Keep the scene, manifest, uploaded video checksum, prompt, seed and model/workflow versions together for a reproducible rerun. Do not mark spatial fidelity as passed without reviewing the actual output.
