# MiniMax H3 base-mode prompt contract

Use these three top-level fields in this order:

```text
integrated_multimodal_description: <chronological visual and audio direction>
overall_soundscape: <diegetic ambience, effects, spatial audio, dialogue policy>
non_diegetic_music: <score genre, energy, instrumentation, or explicitly no music>
```

## `integrated_multimodal_description`

- For image-to-video, put this exact line first, then one blank line: `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`
- Start the timeline with `[Shot 1]` and no timestamp. Introduce every later cut as `[Shot N] At 00:SS.mmm, the camera cuts to ...` with a strictly increasing timestamp.
- For every shot, specify framing, camera position/movement, subject movement, environment reaction, lighting, and the intended transition/cut.
- Preserve continuity across shots and across generated segments.
- Keep all directions physically achievable within the stated time window.

## `overall_soundscape`

- Summarize ambience, physical-action sounds, and non-verbal human sounds without repeating dialogue, singing, or diegetic music from the shot timeline.
- Put requested dialogue in the integrated timeline as `<d>[Language] exact dialogue</d>` and identify its speaker with a stable ID such as `(S1)`.

## `non_diegetic_music`

- State instrumentation, tempo/rhythm, and dynamic development.
- If there is no audience-only score, use `N/A`.

The prompt body is English because the deployed H3 stack follows English production direction more reliably. Requested dialogue, lyrics, and visible text remain in their original language.
