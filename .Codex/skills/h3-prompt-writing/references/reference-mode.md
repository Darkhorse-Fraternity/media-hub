# H3 whole-video reference generation

Source: [MiniMax official reference prompt guide](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt). This project's initial contract accepts one silent motion/previs MP4 plus up to four style/subject images. It uses the existing Ref2VA model with an explicit generation intent.

Write six nonempty fields in this exact order, with English keys and descriptive prose:

```text
subject_definitions: Define <Subject 1> as the finished subject from <Picture 1>, corresponding to the red moving proxy in <Video 1>. Define the stationary blue proxy's final appearance explicitly.
summary: [reference generation] Generate a finished scene using <Video 1> for blocking, camera motion, action timing, spatial layout and occlusion.
retention_analysis: Retain proxy trajectories, relative scale, left/right direction, near/far ordering, lens perspective and event timing. Replace flat proxy colors and primitive geometry with the requested appearance. Use <Picture 1> for subject identity only. Do not carry proxy appearance into the finished scene.
detailed_description: [Shot 1] Describe the initial spatial layout, chronological action, camera movement and final composition. Map each proxy to its finished subject, with explicit times for critical interactions.
overall_soundscape: No dialogue. Generate the requested synchronized physical sounds and ambience.
non_diegetic_music: N/A
```

Replace example objects/actions with the brief and actual scene recipe/manifest. Images are numbered in submitted `reference_images` order: `<Picture 1>` is the first uploaded image. `<Video 1>` is the whole clip, whether supplied as a stored white-model `reference_artifact_id` or an uploaded `reference_video`; use only one input mechanism. Never mention an unprovided Picture/Video/Audio number. Standalone audio references and proxy soundtrack conditioning are unavailable in this path.

For requested exact dialogue, prefer `dialogues[]` in the API; it compiles stable `(S1) <d>[Language] exact words</d>` into `detailed_description` without adding a base-mode field. Preserve requested dialogue/visible-text language. With no dialogue, explicitly state `No dialogue` and avoid speech directions. The API does not run the base-mode prompt optimizer for reference generation; write this contract directly.

Keep one reference generation at 5–15 nominal seconds. Plan multiple shots separately and assemble accepted takes in order with the script assembly API. Ref2VA can reproduce motion structure with variation; inspect the generated clip before accepting trajectory, occlusion or identity fidelity. A correct previs render establishes the intended plan; verify how closely the actual H3 output follows it.
