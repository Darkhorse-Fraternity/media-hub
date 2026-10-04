"""Backport only official H3 AV guide support to the deployed 7d11ec31 tree.

Keeps quantization, attention, scheduling and other local modifications intact.
The upstream excerpts in native-av-compat retain ComfyUI's GPL-3.0 license.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path


def replace_once(source, before, after):
    if source.count(before) != 1:
        raise RuntimeError("ComfyUI source differs from the inspected baseline; stop without writing")
    return source.replace(before, after, 1)


def replace_class(source, name, replacement):
    node = next(n for n in ast.parse(source).body if isinstance(n, ast.ClassDef) and n.name == name)
    lines = source.splitlines(keepends=True)
    return "".join(lines[:node.lineno - 1]) + replacement.rstrip() + "\n" + "".join(lines[node.end_lineno:])


def prepare(root, resources):
    node_path = root / "comfy_extras/nodes_minimax_h3.py"
    model_path = root / "comfy/ldm/minimax/model.py"
    base_path = root / "comfy/model_base.py"
    node = node_path.read_text()
    model = model_path.read_text()
    base = base_path.read_text()
    if "class MiniMaxH3AddGuide(" in node:
        raise RuntimeError("Guide node is already installed; inspect the installed backend before applying")
    guide = (resources / "guide_node.py.txt").read_text()
    # Use the baseline's existing audio encoder/resampler rather than upgrading
    # unrelated audio APIs. Its encoding contract is identical to upstream.
    guide = guide.replace("_encode_ref_audio(audio_vae, audio)", "MiniMaxH3ReferenceToVideo._encode_ref_audio(audio_vae, audio)")
    node = replace_once(node, "import node_helpers\n", "import node_helpers\nfrom comfy.ldm.minimax.model import FRAME_PER_TOKEN, FRAME_RESCALE\n")
    node = replace_once(node, "class MiniMaxH3ReferenceToVideo(io.ComfyNode):", guide + "\n\n\nclass MiniMaxH3ReferenceToVideo(io.ComfyNode):")
    node = replace_once(node, "            MiniMaxH3ImageToVideo,\n", "            MiniMaxH3ImageToVideo,\n            MiniMaxH3AddGuide,\n")

    layout = (resources / "packed_layout.py.txt").read_text()
    layout = replace_once(layout, "keyframes=None, refs=None):", "keyframes=None, refs=None, frame_count=None):")
    model = replace_class(model, "PackedLayout", layout)
    helper = (resources / "ref_t_span.py.txt").read_text()
    model = replace_once(model, "class PackedLayout:", helper + "\n\n\nclass PackedLayout:")
    model = replace_once(model, 'has_aud_cond = any(k == "ref_audio"', 'has_aud_cond = any(k in ("cond_audio", "ref_audio")')
    model = replace_once(model, '"ref_audio": max(t_a, aud_aug)}', '"cond_audio": max(t_a, aud_aug), "ref_audio": max(t_a, aud_aug)}')
    model = replace_once(model, '"ref_img": 0, "ref_audio": 2}', '"ref_img": 0, "cond_audio": 2, "ref_audio": 2}')

    base = replace_once(base, 'payload["cond_video_latents"] = [kf["latent"] for kf in keyframes]', 'payload["cond_video_latents"] = [kf["latent"] for kf in keyframes if kf.get("latent") is not None]\n            payload["cond_audio_latents"] = [kf["audio_latent"] for kf in keyframes if kf.get("audio_latent") is not None]')
    base = replace_once(base, 'payload["cond_audio_latents"] = [r["audio_latent"] for r in refs if r.get("audio_latent") is not None]', 'payload.setdefault("cond_audio_latents", []).extend(r["audio_latent"] for r in refs if r.get("audio_latent") is not None)')
    updates = {node_path: node, model_path: model, base_path: base}
    for path, source in updates.items():
        compile(source, str(path), "exec")
    return updates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--comfy-root", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = args.comfy_root.resolve()
    updates = prepare(root, Path(__file__).parent / "native-av-compat")
    manifest = {str(p.relative_to(root)): {"before": hashlib.sha256(p.read_bytes()).hexdigest(), "after": hashlib.sha256(s.encode()).hexdigest()} for p, s in updates.items()}
    if not args.dry_run:
        if args.backup_dir.exists():
            raise RuntimeError("Backup directory already exists; do not replace a rollback snapshot")
        args.backup_dir.mkdir(parents=True)
        for path in updates:
            backup = args.backup_dir / path.relative_to(root)
            backup.parent.mkdir(parents=True, exist_ok=True)
            backup.write_bytes(path.read_bytes())
        (args.backup_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
        for path, source in updates.items():
            temporary = path.with_suffix(path.suffix + ".native-av.tmp")
            temporary.write_text(source)
            temporary.replace(path)
    print(json.dumps({"dry_run": args.dry_run, "files": manifest}))


if __name__ == "__main__":
    main()
