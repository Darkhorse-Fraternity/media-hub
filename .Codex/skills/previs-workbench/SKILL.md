---
name: previs-workbench
description: Manage and reuse Media Hub lightweight white-model scenes (白模场景库) through the Agent API. Use for scene discovery, groups, thumbnails, introductions, copying templates, versioned edits, and Crucible PNG or motion-reference exports.
---

# Media Hub white-model workbench

Read [the API workflow](../../../docs/previs-scenes.md) for request examples and deployment requirements. The repository contract is API `1.12.0`; fetch the deployment's `/api/openapi` before using it because deployment may lag the repository. Use the existing Media Hub Bearer token without printing it. REST request fields use snake_case; responses use camelCase; Crucible recipe fields retain their native spelling.

## Discover and reuse

Search `GET /api/v1/previs?search=...` and inspect scene introductions, `thumbnailArtifactId`, and selected revisions before creating another scene. Use `GET /api/v1/previs-groups` to find existing categories; filter scenes with `group_id=<UUID>` or `group_id=ungrouped`. Omit the filter for all groups. Read thumbnails through the authenticated artifact download API.

When adapting a template for a separate brief, call `POST /api/v1/previs/{sceneId}/fork` with a real `revision_id`. The copy inherits the introduction and group, records its source, and has an independent version history. Edit the copy and revise its introduction to describe the new use. When the user requests changes to the original, edit that scene instead.

| Operation                    | API and request                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Create a group               | `POST /api/v1/previs-groups` with `name`                                                                               |
| Rename a group               | `PATCH /api/v1/previs-groups/{groupId}` with current group `version` and `name`                                        |
| Remove a group               | `DELETE /api/v1/previs-groups/{groupId}` with current group `version`; scenes remain ungrouped                         |
| Introduce or move a scene    | `PATCH /api/v1/previs/{sceneId}` with current scene `version`, `description`, and/or `group_id`; null clears the group |
| Select a cover               | Same scene PATCH with current `version` and `thumbnail_artifact_id` from a successful PNG belonging to this scene      |
| Restore automatic covers     | Same scene PATCH with current `version` and `thumbnail_artifact_id: null`                                              |
| Request or retry a thumbnail | `POST /api/v1/previs/{sceneId}/thumbnail`; poll the returned render batch                                              |

Automatic covers use the current revision's scene camera at its initial time, at 320×180. The CPU worker fills them when idle; manual covers remain selected across later edits and rollback. Group/intro/cover selection edits require scene CAS but do not create a recipe revision. Group deletion advances affected scene versions, so reread before later edits. Automatic cover completion updates derived fields without advancing the authoring version. `thumbnailRevisionId` identifies the cover's source revision.

## Edit and render

- The authoritative document is a Crucible `0.20.0` JSON recipe plus named camera views. Use stable node IDs; save edits as new revisions. Blender compatibility is outside this feature.
- Read the selected revision and scene version before editing. Full recipe and atomic operations are mutually exclusive. Historical parents create branches; advancing the selected revision requires explicit CAS. On 409, inspect the latest state before resubmitting.
- Render a specific saved revision with `POST /api/v1/previs/{sceneId}/renders`. Use an idempotency key per logical request. Poll the batch and ordered items; a successful HTTP submission is not a finished render.
- Export PNGs for composition, subject placement and starting poses. Select view IDs and one-based sample frames. A static scene can omit frames. Retry only failed/interrupted/canceled items and keep successful outputs. Inspect the produced images or video before handing them downstream.
- For a photorealistic shot, reuse a suitable original photo as the first frame. When a new first frame is needed, import the chosen white-model PNG through the batch's `/image-assets` endpoint as a layout reference for still-image generation. Select the finished photorealistic image for video generation. See the [still-image workflow](../media-hub-video/SKILL.md#generate-from-white-modelprevis).
- When the user explicitly asks to reproduce the preview's timing or camera path and permits video input, render a short MP4 with `profile=h3_reference`, 24 FPS and 5 nominal seconds. The API aligns it to 124 frames. Set the output duration independently. Use the artifact's `reference_artifact_id` in the director API or with `generation_mode=reference` on a standalone job. Use the H3 six-field prompt contract. The reference is pinned to the artifact and revision.
- CPU/Chromium is the implemented worker backend. There is no production GPU/Broker execution path to select. Do not bypass shared GPU scheduling.
