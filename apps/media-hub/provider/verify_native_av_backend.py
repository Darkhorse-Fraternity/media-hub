"""Small CPU regression for guide packing and the deployed H3 forward path.

Run from the ComfyUI root with its Python interpreter; no model weights needed.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
import torch
import comfy.ops
from comfy.ldm.minimax.model import MiniMaxH3Model, PackedLayout
from comfy_extras.nodes_minimax_h3 import MiniMaxH3AddGuide


video_guide = torch.zeros(1, 24, 7, 2, 2)
audio_guide = torch.zeros(1, 32, 2, 37)
guides = [{"resolved_frame_index": 0, "latent": video_guide, "audio_latent": audio_guide}]
layout = PackedLayout(4, 12, 2, 2, 64, keyframes=guides)
assert sum(b-a for a,b,k in layout.segments if k == "cond") == 7
assert sum(b-a for a,b,k in layout.segments if k == "cond_audio") == 74
assert int((~layout.img_update).sum()) == 7
assert int((~layout.audio_update).sum()) == 74

# A following chosen first frame must remain after the 22-frame AV guide.
anchored = PackedLayout(4, 12, 2, 2, 64, keyframes=guides + [
    {"resolved_frame_index": 22, "latent": torch.zeros(1,24,1,2,2)}])
assert int((~anchored.img_update).sum()) == 8
assert int((~anchored.audio_update).sum()) == 74

model = MiniMaxH3Model(hidden_size=192, num_layers=0,
    token_refiner_num_layers=0, num_attention_heads=2, attention_head_dim=96,
    ffn_hidden_size=384, text_dim=192, time_embed_hidden_size=192,
    time_embed_dim=96, dtype=torch.float32, device=torch.device("cpu"),
    operations=comfy.ops.disable_weight_init)
for parameter in model.parameters():
    parameter.data.zero_()
model.rope.inv_freq.zero_()
video = torch.zeros(1,24,12,2,2)
audio = torch.zeros(1,32,2,64)
payload = {"layout": layout, "keyframes": guides,
    "cond_video_latents": [video_guide], "cond_audio_latents": [audio_guide],
    "audio_scale": 1.0}
with torch.no_grad():
    result = model([video,audio], torch.tensor([500.0]), torch.zeros(1,4,192),
        minimax_payload=payload)
assert result[0].shape == video.shape and result[1].shape == audio.shape
assert all(torch.isfinite(stream).all() for stream in result)
print("PASS: synchronized video/audio guide rows, subsequent frame anchor, CPU H3 forward shapes and finite outputs")
