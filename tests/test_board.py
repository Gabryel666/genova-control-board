"""Tests for the Hermes side of Genova Control Board.

They never touch the real Stream Deck installation: every install runs against a
temporary plugins folder. What is asserted is what the plugin promises —
the bundle is complete, a previous version is backed up, and a folder belonging
to another plugin is left alone.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

import board  # noqa: E402


def _write_manifest(folder: Path, uuid: str, version: str = "0.0.1.0") -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "manifest.json").write_text(json.dumps({"UUID": uuid, "Version": version}), encoding="utf-8")


class BundledAssets(unittest.TestCase):
    def test_bundle_is_complete(self):
        bundle = board.bundled()
        self.assertTrue(bundle["complete"], bundle)
        self.assertRegex(bundle["version"], r"^\d+\.\d+\.\d+\.\d+$")

    def test_manifest_declares_four_actions(self):
        manifest = json.loads((board.ASSETS / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["UUID"], board.PLUGIN_UUID)
        self.assertEqual(len(manifest["Actions"]), 4)

    def test_every_asset_the_manifest_points_at_exists(self):
        """A missing icon or property inspector is a plugin Stream Deck silently misloads."""
        sd = board.ASSETS
        manifest = json.loads((sd / "manifest.json").read_text(encoding="utf-8"))
        missing: list[str] = []

        bases = [manifest["Icon"], manifest["CategoryIcon"]]
        for action in manifest["Actions"]:
            bases.extend([action["Icon"], action["States"][0]["Image"]])
            inspector = action.get("PropertyInspectorPath")
            if inspector and not (sd / inspector).exists():
                missing.append(inspector)

        for base in bases:
            for suffix in (".png", "@2x.png"):
                if not (sd / f"{base}{suffix}").exists():
                    missing.append(f"{base}{suffix}")

        self.assertEqual(missing, [], f"fichiers manquants : {missing}")


class Install(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="gcb-test-"))
        self.plugins = self.root / "Plugins"
        self.plugins.mkdir()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_copies_the_board(self):
        report = board.install(target_dir=str(self.plugins), restart=False)
        self.assertTrue(report["ok"], report)
        target = self.plugins / f"{board.PLUGIN_UUID}.sdPlugin"
        self.assertTrue((target / "manifest.json").is_file())
        self.assertTrue((target / "bin" / "plugin.js").is_file())
        self.assertEqual(report["version"], board.bundled()["version"])

    def test_backs_up_an_existing_version(self):
        target = self.plugins / f"{board.PLUGIN_UUID}.sdPlugin"
        _write_manifest(target, board.PLUGIN_UUID, "0.0.9.0")

        report = board.install(target_dir=str(self.plugins), restart=False)
        self.assertTrue(report["ok"], report)
        backup = Path(report["backup"])
        self.assertTrue(backup.is_dir())
        saved = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["Version"], "0.0.9.0")

    def test_refuses_a_foreign_plugin_folder(self):
        target = self.plugins / f"{board.PLUGIN_UUID}.sdPlugin"
        _write_manifest(target, "com.autre.plugin", "9.9.9.9")

        report = board.install(target_dir=str(self.plugins), restart=False)
        self.assertFalse(report["ok"])
        self.assertIn("com.autre.plugin", report["error"])
        # The foreign manifest is untouched.
        kept = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(kept["UUID"], "com.autre.plugin")

    def test_reports_a_missing_target(self):
        report = board.install(target_dir=str(self.root / "nope"), restart=False)
        self.assertFalse(report["ok"])
        self.assertIn("inexistant", report["error"])


class Paths(unittest.TestCase):
    def test_windows_path_conversion(self):
        self.assertEqual(
            board._windows_path(Path("/mnt/c/Program Files/Elgato/StreamDeck/StreamDeck.exe")),
            "C:\\Program Files\\Elgato\\StreamDeck\\StreamDeck.exe",
        )

    def test_windows_path_leaves_other_platforms_alone(self):
        self.assertEqual(board._windows_path(Path("/Applications/x.app")), "\\Applications\\x.app")


class Summarise(unittest.TestCase):
    def test_offline_gateway_is_stated_plainly(self):
        report = {
            "board": {
                "bundled_version": "0.1.0.0",
                "installed": {"found": False},
                "up_to_date": False,
            },
            "system": {"stream_deck_running_pid": None},
            "gateway": {"reachable": False, "url": "http://localhost:9119", "error": "refused", "endpoints": []},
        }
        text = board.summarise(report)
        self.assertIn("n'est pas installé", text)
        self.assertIn("ne tourne pas", text)
        self.assertIn("ne répond pas", text)


if __name__ == "__main__":
    unittest.main()
