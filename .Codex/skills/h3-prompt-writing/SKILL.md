---
name: h3-prompt-writing
description: Write or revise MiniMax Hailuo 3 (H3) video prompts for Media Hub. Use when changing H3 prompt optimization, generation presets, multi-segment video behavior, or reviewing H3 prompt quality.
---

# H3 Prompt Writing

Use the exact H3 prompt contract in [references/base-mode.md](references/base-mode.md). Keep the implementation and tests aligned with that reference.

## Workflow

1. Determine whether generation is text-to-video or image-to-video. Media Hub currently uses image-to-video whenever a first-frame image is supplied.
2. Rewrite the user's intent into a concrete, chronological shot plan. Do not add unrelated subjects, dialogue, text, or plot events.
3. Write the structural keys and descriptive prose in English. Preserve dialogue, lyrics, signs, and other visible text in the language requested by the user.
4. Include official shot timing, camera movement, subject motion, lighting, spatial relations, sound effects, ambience, and music intent.
5. For image-to-video, begin with the exact first-frame alignment sentence from the reference and describe only motion that follows from the supplied image.
6. Keep each H3 segment at or below 15 seconds. For a longer request, return one self-contained prompt per segment using the exact segment markers below.
7. Return prompt text only. Do not add Markdown fences, commentary, a title, or an explanation.

## Long-video format

For a request containing `N` segments, return exactly `N` sections:

```text
=== SEGMENT 1/N ===
<complete H3 prompt for segment 1>
=== SEGMENT 2/N ===
<complete H3 prompt for segment 2>
```

Every later segment must repeat the stable identity/style constraints and start from the prior segment's ending composition. Media Hub additionally feeds the previous segment's final frame back as the next first frame.

## Guardrails

- Never describe a 30–60 second story as one H3 prompt; H3 generates it as multiple clips.
- Never replace concrete timing with vague phrases such as “cinematic movement” or “dynamic scene.”
- Do not invent speech or background vocals unless requested.
- Do not contradict the first image's subject identity, clothing, layout, viewpoint, palette, or lighting without an explicit transition.
- Prefer one achievable camera move and one clear subject action per shot.
