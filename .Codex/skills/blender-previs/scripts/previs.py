#!/usr/bin/env python3
"""Deterministic primitive blocking and H3 reference-video preparation."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys


def frame_count(duration: int) -> int:
    if isinstance(duration, bool) or not isinstance(duration, int) or not 5 <= duration <= 15:
        raise ValueError("duration_seconds must be an integer from 5 to 15")
    return min(362, math.ceil((duration * 24 - 5) / 17) * 17 + 5)


def vector(value, size=3):
    if not isinstance(value, list) or len(value) != size or any(
        isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in value
    ):
        raise ValueError(f"Expected a finite {size}-component vector")
    return value


def plan(spec: dict) -> dict:
    if spec.get("version") != 1:
        raise ValueError("Scene version must be 1")
    frames = frame_count(spec.get("duration_seconds"))
    for name in ("width", "height"):
        value = spec.get(name)
        if isinstance(value, bool) or not isinstance(value, int) or not 64 <= value <= 1344 or value % 32:
            raise ValueError(f"{name} must be a multiple of 32 between 64 and 1344")
    objects = spec.get("objects")
    if not isinstance(objects, list) or not 1 <= len(objects) <= 50:
        raise ValueError("Provide 1–50 proxy objects")
    ids = [item["id"] for item in objects]
    if len(set(ids)) != len(ids) or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", name) for name in ids):
        raise ValueError("Proxy IDs must be unique identifiers")
    camera = spec["camera"]
    lens = camera.get("lens_mm", 50)
    if isinstance(lens, bool) or not isinstance(lens, (int, float)) or not 10 <= lens <= 200:
        raise ValueError("Camera lens must be 10–200 mm")
    for item in [camera, *objects]:
        keys = item.get("keyframes", [])
        numbers = [key["frame"] for key in keys]
        if not numbers or numbers[0] != 1 or numbers != sorted(set(numbers)) or any(
            isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= frames for n in numbers
        ):
            raise ValueError("Keyframes must start at 1, increase strictly, and fit the H3 frame count")
        for key in keys:
            vector(key["location"])
            if item is camera:
                vector(key["target"])
                if key["location"] == key["target"]:
                    raise ValueError("Camera target must differ from its location")
            else:
                vector(key.get("rotation_degrees", [0, 0, 0]))
    for item in objects:
        if item.get("primitive") not in {"box", "sphere", "cylinder"}:
            raise ValueError("Primitive must be box, sphere or cylinder")
        if any(v <= 0 for v in vector(item["scale"])):
            raise ValueError("Scale components must be positive")
        if any(not 0 <= v <= 1 for v in vector(item["color"], 4)):
            raise ValueError("RGBA colors must be between zero and one")
    return {
        "fps": 24, "frames": frames, "duration_seconds": frames / 24,
        "requested_duration_seconds": spec["duration_seconds"],
        "width": spec["width"], "height": spec["height"],
        "proxy_ids": ids,
    }


def normalize(source: Path, output: Path, duration: int, width: int, height: int):
    frames = frame_count(duration)
    if source.resolve() == output.resolve():
        raise ValueError("Input and output must differ")
    if width % 32 or height % 32 or not 64 <= width <= 1344 or not 64 <= height <= 1344:
        raise ValueError("Output dimensions must be multiples of 32 from 64 to 1344")
    subprocess.run([
        os.environ.get("FFMPEG_PATH", "ffmpeg"), "-hide_banner", "-loglevel", "error", "-n",
        "-i", str(source), "-map", "0:v:0", "-an", "-vf",
        f"fps=24,scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,tpad=stop_mode=clone:stop_duration=16",
        "-frames:v", str(frames), "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-crf", "18", "-movflags", "+faststart", str(output),
    ], check=True)


def interpolate(keys, frame, name):
    right = next((key for key in keys if key["frame"] >= frame), keys[-1])
    left = next((key for key in reversed(keys) if key["frame"] <= frame), keys[0])
    fraction = (frame - left["frame"]) / max(1, right["frame"] - left["frame"])
    return [a + (b - a) * fraction for a, b in zip(left[name], right[name])]


def remote_command(host: str, command: list[str]) -> list[str]:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]*", host):
        raise ValueError("Use a configured SSH host alias")
    return ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", host, shlex.join(command)]


def render_remote(scene: Path, output: Path, host: str, blender_path: str | None):
    if output.exists():
        raise ValueError("Output directory already exists; choose a new take directory")

    def remote(command, capture=False):
        return subprocess.run(remote_command(host, command), check=True, text=True,
                              capture_output=capture, timeout=1800)

    home = remote(["python3", "-c", "from pathlib import Path; print(Path.home())"], True).stdout.strip()
    if not home.startswith("/") or "\n" in home:
        raise ValueError("Remote home directory is invalid")
    gpu = remote(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"], True).stdout.strip()
    values = [float(value.strip()) for value in gpu.splitlines()[0].split(",")]
    if values[0] > 20 or values[1] > 4096:
        raise ValueError("5090 is busy; render previs after the active GPU task completes")
    root = f"{home}/.cache/media-hub/previs"
    remote(["mkdir", "-p", root])
    run_dir = remote(["mktemp", "-d", f"{root}/run-XXXXXXXX"], True).stdout.strip()
    if not run_dir.startswith(root + "/run-") or "\n" in run_dir:
        raise ValueError("Remote run directory is invalid")
    print(f"Rendering on {host} in {run_dir}", file=sys.stderr, flush=True)
    for source, destination in [(Path(__file__).resolve(), "previs.py"), (scene.resolve(), "scene.json")]:
        subprocess.run(["scp", "-B", "-q", "--", str(source), f"{host}:{run_dir}/{destination}"], check=True, timeout=60)
    remote(["env", f"BLENDER_PATH={blender_path or home + '/.local/bin/blender'}", "python3",
            f"{run_dir}/previs.py", "render", f"{run_dir}/scene.json", f"{run_dir}/render"])
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["scp", "-B", "-q", "-r", "--", f"{host}:{run_dir}/render", str(output.resolve())], check=True, timeout=300)
    manifest = json.loads((output / "manifest.json").read_text())
    checksum = "sha256:" + hashlib.sha256((output / "previs.mp4").read_bytes()).hexdigest()
    if checksum != manifest["video_checksum"]:
        raise ValueError("Downloaded previs checksum does not match the remote manifest")
    return {"host": host, "remote_run_dir": run_dir, "local_output": str(output.resolve()), "video_checksum": checksum}


def build(spec_path: Path, output: Path):
    import bpy
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector

    spec = json.loads(spec_path.read_text())
    metadata = plan(spec)
    output.mkdir(parents=True, exist_ok=False)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = spec["width"]
    scene.render.resolution_y = spec["height"]
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    scene.frame_start, scene.frame_end = 1, metadata["frames"]
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_shadows = True
    scene.display.shading.background_type = "WORLD"
    scene.world.color = (0.5, 0.5, 0.5)
    scene.unit_settings.system = "METRIC"
    bpy.ops.mesh.primitive_plane_add(size=200)
    bpy.context.object.name = "previs_floor"
    bpy.context.object.color = (0.65, 0.65, 0.65, 1)
    proxies = []
    constructors = {
        "box": bpy.ops.mesh.primitive_cube_add,
        "sphere": bpy.ops.mesh.primitive_uv_sphere_add,
        "cylinder": bpy.ops.mesh.primitive_cylinder_add,
    }
    for item in spec["objects"]:
        constructors[item["primitive"]]()
        obj = bpy.context.object
        obj.name, obj.scale, obj.color = item["id"], item["scale"], item["color"]
        for key in item["keyframes"]:
            obj.location = key["location"]
            obj.rotation_euler = [math.radians(v) for v in key.get("rotation_degrees", [0, 0, 0])]
            obj.keyframe_insert("location", frame=key["frame"])
            obj.keyframe_insert("rotation_euler", frame=key["frame"])
        proxies.append(obj)
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = "previs_camera"
    camera.data.lens = spec["camera"].get("lens_mm", 50)
    scene.camera = camera
    samples = []
    sample_frames = {1 + round(i * (metadata["frames"] - 1) / 4) for i in range(5)}
    # Bake every transform at 24 FPS, independent of Blender's default Bezier interpolation.
    for frame in range(1, metadata["frames"] + 1):
        scene.frame_set(frame)
        for obj, item in zip(proxies, spec["objects"]):
            obj.location = interpolate(item["keyframes"], frame, "location")
            obj.rotation_euler = [math.radians(v) for v in interpolate([
                {**key, "rotation_degrees": key.get("rotation_degrees", [0, 0, 0])} for key in item["keyframes"]
            ], frame, "rotation_degrees")]
            obj.keyframe_insert("location", frame=frame)
            obj.keyframe_insert("rotation_euler", frame=frame)
        camera.location = interpolate(spec["camera"]["keyframes"], frame, "location")
        target = Vector(interpolate(spec["camera"]["keyframes"], frame, "target"))
        direction = target - camera.location
        if direction.length < 1e-6:
            raise ValueError(f"Camera intersects its target at frame {frame}")
        camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        camera.keyframe_insert("location", frame=frame)
        camera.keyframe_insert("rotation_euler", frame=frame)
        bpy.context.view_layer.update()
        if frame in sample_frames:
            bounds = {}
            for obj in proxies:
                points = [world_to_camera_view(scene, camera, obj.matrix_world @ Vector(corner)) for corner in obj.bound_box]
                bounds[obj.name] = {
                    "bbox_xy_bottom_left": [min(p.x for p in points), min(p.y for p in points), max(p.x for p in points), max(p.y for p in points)],
                    "camera_depth": [min(p.z for p in points), max(p.z for p in points)],
                }
            samples.append({"frame": frame, "time_seconds": (frame - 1) / 24, "camera_matrix_world": [list(row) for row in camera.matrix_world], "proxies": bounds})
    scene.render.image_settings.file_format = "PNG"
    (output / "frames").mkdir()
    scene.render.filepath = str(output / "frames" / "frame_")
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "previs.blend"))
    bpy.ops.render.render(animation=True)
    subprocess.run([
        os.environ.get("FFMPEG_PATH", "ffmpeg"), "-hide_banner", "-loglevel", "error", "-n",
        "-framerate", "24", "-start_number", "1", "-i", str(output / "frames" / "frame_%04d.png"),
        "-frames:v", str(metadata["frames"]), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-crf", "18", "-movflags", "+faststart", str(output / "previs.mp4"),
    ], check=True)
    checksum = "sha256:" + hashlib.sha256((output / "previs.mp4").read_bytes()).hexdigest()
    (output / "manifest.json").write_text(json.dumps({**metadata, "blender_version": bpy.app.version_string, "video_checksum": checksum, "scene": spec, "samples": samples}, indent=2) + "\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "render", "render-remote", "_build"):
        command = commands.add_parser(name)
        command.add_argument("scene", type=Path)
        if name != "plan":
            command.add_argument("output", type=Path)
        if name == "render-remote":
            command.add_argument("--host", default="5090")
            command.add_argument("--blender-path", help="Remote executable; default ~/.local/bin/blender")
    command = commands.add_parser("normalize")
    command.add_argument("source", type=Path)
    command.add_argument("output", type=Path)
    command.add_argument("--duration", type=int, required=True)
    command.add_argument("--width", type=int, default=1344)
    command.add_argument("--height", type=int, default=768)
    args = parser.parse_args(argv)
    if args.command == "normalize":
        normalize(args.source, args.output, args.duration, args.width, args.height)
    elif args.command == "_build":
        build(args.scene, args.output.resolve())
    else:
        metadata = plan(json.loads(args.scene.read_text()))
        if args.command == "render":
            subprocess.run([
                os.environ.get("BLENDER_PATH", "blender"), "--background", "--factory-startup",
                "--python-exit-code", "1", "--python", str(Path(__file__).resolve()), "--",
                "_build", str(args.scene.resolve()), str(args.output.resolve()),
            ], check=True)
        elif args.command == "render-remote":
            metadata.update(render_remote(args.scene, args.output, args.host, args.blender_path))
        print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    try:
        main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else None)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc)) from None
