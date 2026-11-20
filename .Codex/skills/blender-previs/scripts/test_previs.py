import copy
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("previs", ROOT / "previs.py")
previs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(previs)


class PrevisPlanTests(unittest.TestCase):
    def setUp(self):
        self.scene = json.loads((ROOT.parent / "assets/example.scene.json").read_text())

    def test_grid_matches_api(self):
        self.assertEqual([previs.frame_count(n) for n in (5, 10, 15)], [124, 243, 362])
        self.assertEqual(previs.plan(self.scene)["frames"], 124)

    def test_remote_command_quotes_paths_and_rejects_ssh_option_injection(self):
        command = ["python3", "/home/a/my scenes/previs.py", "render", "/tmp/a's scene.json"]
        argv = previs.remote_command("5090", command)
        self.assertEqual(shlex.split(argv[-1]), command)
        self.assertIn("BatchMode=yes", argv)
        for host in ("-oProxyCommand=bad", "5090; bad", "host\ncommand"):
            with self.assertRaises(ValueError):
                previs.remote_command(host, command)

    def test_duplicate_proxies_and_out_of_range_keys_fail(self):
        self.scene["objects"].append(copy.deepcopy(self.scene["objects"][0]))
        with self.assertRaises(ValueError):
            previs.plan(self.scene)
        self.scene["objects"].pop()
        self.scene["camera"]["keyframes"][-1]["frame"] = 125
        with self.assertRaises(ValueError):
            previs.plan(self.scene)

    def test_interpolation_holds_endpoints(self):
        keys = self.scene["objects"][0]["keyframes"]
        self.assertEqual(previs.interpolate(keys, 1, "location"), [-2, -0.5, 1])
        self.assertEqual(previs.interpolate(keys, 124, "location"), [2, -0.5, 1])
        self.assertEqual(previs.interpolate(keys, 200, "location"), [2, -0.5, 1])

    def test_normalize_cli_produces_silent_h3_grid(self):
        with TemporaryDirectory() as directory:
            source, output = Path(directory) / "source.mp4", Path(directory) / "previs.mp4"
            subprocess.run([os.environ.get("FFMPEG_PATH", "ffmpeg"), "-v", "error", "-f", "lavfi",
                            "-i", "color=c=gray:s=160x90:r=30", "-frames:v", "60", "-c:v", "libx264", str(source)], check=True)
            subprocess.run([sys.executable, str(ROOT / "previs.py"), "normalize", str(source), str(output),
                            "--duration", "5", "--width", "96", "--height", "64"], check=True)
            result = subprocess.run([os.environ.get("FFPROBE_PATH", "ffprobe"), "-v", "error", "-count_frames",
                                     "-show_streams", "-of", "json", str(output)], check=True, capture_output=True, text=True)
            streams = json.loads(result.stdout)["streams"]
            self.assertEqual(len(streams), 1)
            self.assertEqual(streams[0]["nb_read_frames"], "124")
            self.assertEqual(streams[0]["avg_frame_rate"], "24/1")
            self.assertEqual((streams[0]["width"], streams[0]["height"]), (96, 64))


if __name__ == "__main__":
    unittest.main()
