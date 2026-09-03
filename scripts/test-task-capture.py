import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("capture", Path(__file__).with_name("pke-task-capture.py"))
capture = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = capture
spec.loader.exec_module(capture)


class CaptureTests(unittest.TestCase):
    def test_keeps_previous_days_and_only_exports_closed_segments(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "drafts.json"
            recorder = capture.Capture("Miguel", output)
            segment = capture.Segment("old", "2026-09-01", "09:00", "09:15", "Task", "Outro", "Test", "", "Miguel", 1, 100, 1000)
            recorder.segments.append(segment)
            recorder.current = capture.Segment("active", "2026-09-02", "09:00", "09:15", "Task", "Outro", "Test", "", "Miguel", 1, 2000, 2001)
            recorder.write()
            reloaded = capture.Capture("Miguel", output)
            self.assertEqual([item.id for item in reloaded.segments], ["old"])
            self.assertEqual(json.loads(output.read_text())["entries"][0]["date"], "2026-09-01")

    def test_does_not_overwrite_invalid_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "drafts.json"
            output.write_text("broken")
            with self.assertRaises(RuntimeError):
                capture.Capture("Miguel", output)
            self.assertEqual(output.read_text(), "broken")


if __name__ == "__main__":
    unittest.main()
