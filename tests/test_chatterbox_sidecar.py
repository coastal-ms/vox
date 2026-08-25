import importlib.util
import os
import tempfile
import unittest
import wave
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "chatterbox-sidecar.py"
SPEC = importlib.util.spec_from_file_location("vox_chatterbox_sidecar", MODULE_PATH)
SIDECAR = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(SIDECAR)


class ChatterboxSidecarTests(unittest.TestCase):
    def test_reference_must_be_a_valid_wav_under_voices_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "voices"
            root.mkdir()
            reference = root / "authorized-reference.wav"
            with wave.open(str(reference), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(16000)
                output.writeframes(b"\0\0" * 160)
            self.assertEqual(SIDECAR.validate_reference(str(reference), str(root)), reference.resolve())

            outside = Path(directory) / "outside.wav"
            outside.write_bytes(reference.read_bytes())
            with self.assertRaisesRegex(ValueError, "must stay under"):
                SIDECAR.validate_reference(str(outside), str(root))

    def test_cache_environment_remains_under_selected_local_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "cache"
            SIDECAR.configure_cache(cache)
            self.assertEqual(os.environ["HF_HOME"], str(cache))
            self.assertEqual(os.environ["TORCH_HOME"], str(cache / "torch"))

    def test_pre_canceled_request_does_not_invoke_model(self):
        class Model:
            def generate(self, _text):
                raise AssertionError("model should not run")

        runtime = SIDECAR.ModelRuntime(Model(), 24000)
        runtime.cancel("request-1")
        self.assertEqual(runtime.synthesize("hello", "request-1"), (None, 0))


if __name__ == "__main__":
    unittest.main()
