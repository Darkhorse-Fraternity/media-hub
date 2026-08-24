# Media Hub H3 Provider

This directory contains a Provider implementation for a GPU host. It supports
both the FL2VA generation profile and the Ref2VA editing profile.

- Provider source: `generated_media_comfyui_provider.py`
- Ref2VA profile fragment: `ref2va-profile.json`
- GPU execution is serialized by the Provider's single-worker executor.
- Switching between FL2VA and Ref2VA unloads the active ComfyUI model before the
  next transformer is loaded.
- Ref2VA accepts one source video plus up to two additional reference videos and
  nine images. Media Hub currently submits one 2–15 second source clip and up to
  four per-segment style/subject images.

Set `YDC_GENERATED_MEDIA_PROVIDER_CONFIG` to the local Provider configuration
path and run `generated_media_comfyui_provider.py` as the service entrypoint.
