"""Local-only CPU Chatterbox Nano HTTP sidecar for Vox."""

from __future__ import annotations

import argparse
import ctypes
import io
import json
import os
import signal
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MAX_BODY_BYTES = 64 * 1024
MAX_TEXT_CHARS = 1200
NANO_REPO_ID = "ResembleAI/chatterbox-nano"
NANO_MODEL_FILES = (
    "added_tokens.json",
    "merges.txt",
    "s3gen_meanflow.safetensors",
    "special_tokens_map.json",
    "t3_nano_v1.safetensors",
    "tokenizer_config.json",
    "ve.safetensors",
    "vocab.json",
)


def emit(event: str, **values: Any) -> None:
    print(json.dumps({"event": event, **values}, separators=(",", ":")), flush=True)


def path_inside(candidate: Path, parent: Path) -> bool:
    try:
        candidate.resolve(strict=False).relative_to(parent.resolve(strict=False))
        return True
    except ValueError:
        return False


def validate_reference(reference: str, voices_root: str) -> Path:
    resolved = Path(reference).resolve(strict=True)
    root = Path(voices_root).resolve(strict=True)
    if not path_inside(resolved, root):
        raise ValueError(f"reference must stay under {root}")
    if resolved.suffix.lower() != ".wav" or not resolved.is_file():
        raise ValueError("reference must be an existing WAV file")
    if resolved.stat().st_size == 0:
        raise ValueError("reference WAV is empty")
    with wave.open(str(resolved), "rb") as source:
        if source.getnchannels() < 1 or source.getframerate() < 8_000:
            raise ValueError("reference WAV has an unsupported audio format")
    return resolved


def tensor_to_wav(audio: Any, sample_rate: int) -> bytes:
    samples = audio.detach().cpu().float()
    if getattr(samples, "ndim", 1) > 1:
        samples = samples[0]
    values = samples.numpy().clip(-1.0, 1.0)
    pcm = (values * 32767.0).astype("<i2").tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(int(sample_rate))
        target.writeframes(pcm)
    return output.getvalue()


class ModelRuntime:
    def __init__(self, model: Any, sample_rate: int) -> None:
        self.model = model
        self.sample_rate = sample_rate
        self._inference_lock = threading.Lock()
        self._cancel_lock = threading.Lock()
        self._canceled: set[str] = set()

    def cancel(self, request_id: str) -> None:
        with self._cancel_lock:
            self._canceled.add(request_id)

    def _take_canceled(self, request_id: str) -> bool:
        with self._cancel_lock:
            if request_id not in self._canceled:
                return False
            self._canceled.remove(request_id)
            return True

    def synthesize(self, text: str, request_id: str) -> tuple[bytes | None, int]:
        with self._inference_lock:
            if self._take_canceled(request_id):
                return None, 0
            began = time.perf_counter()
            audio = self.model.generate(text)
            elapsed_ms = round((time.perf_counter() - began) * 1000)
            if self._take_canceled(request_id):
                return None, elapsed_ms
            return tensor_to_wav(audio, self.sample_rate), elapsed_ms


def configure_cache(cache: Path) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(cache)
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(cache / "hub")
    os.environ["TRANSFORMERS_CACHE"] = str(cache / "transformers")
    os.environ["TORCH_HOME"] = str(cache / "torch")
    # Xet can stall without surfacing download progress on managed Windows
    # networks. Standard HTTPS is reliable and keeps every model file local.
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "120")


def cached_bytes(cache: Path) -> int:
    total = 0
    for entry in cache.rglob("*"):
        try:
            if entry.is_file():
                total += entry.stat().st_size
        except OSError:
            # Hugging Face atomically replaces temporary files while the
            # progress monitor walks the cache.
            continue
    return total


def download_nano_model(cache: Path, snapshot_download_fn: Any = None) -> Path:
    if snapshot_download_fn is None:
        from huggingface_hub import snapshot_download

        snapshot_download_fn = snapshot_download

    stopped = threading.Event()

    def report_progress() -> None:
        while not stopped.wait(2):
            mib = cached_bytes(cache) / (1024 * 1024)
            emit("status", detail=f"Downloading Chatterbox Nano ({mib:.0f} MiB cached)")

    emit("status", detail="Downloading Chatterbox Nano model")
    monitor = threading.Thread(target=report_progress, daemon=True)
    monitor.start()
    try:
        return Path(snapshot_download_fn(
            repo_id=NANO_REPO_ID,
            allow_patterns=list(NANO_MODEL_FILES),
            cache_dir=str(cache / "hub"),
            token=os.getenv("HF_TOKEN") or None,
        ))
    finally:
        stopped.set()
        monitor.join(timeout=3)


def wait_for_parent_exit(parent_pid: int) -> None:
    """Wait without holding the GIL until the owning Node process exits."""
    if os.name == "nt":
        process_synchronize = 0x00100000
        infinite = 0xFFFFFFFF
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = (ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32)
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
        kernel32.WaitForSingleObject.restype = ctypes.c_uint32
        kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)

        handle = kernel32.OpenProcess(process_synchronize, False, parent_pid)
        if not handle:
            return
        try:
            kernel32.WaitForSingleObject(handle, infinite)
        finally:
            kernel32.CloseHandle(handle)
        return

    while os.getppid() == parent_pid:
        time.sleep(1)


def watch_parent_process(parent_pid: int) -> None:
    wait_for_parent_exit(parent_pid)
    os._exit(0)


def load_runtime(reference: Path, cache: Path, threads: int) -> ModelRuntime:
    configure_cache(cache)
    emit("status", detail="Importing Chatterbox Nano")
    import torch
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    torch.set_num_threads(threads)
    try:
        torch.set_num_interop_threads(1)
    except RuntimeError:
        pass
    model_path = download_nano_model(cache)
    emit("status", detail="Loading Chatterbox Nano on CPU")
    model = ChatterboxTurboTTS.from_local(model_path, device="cpu", nano=True)
    emit("status", detail="Conditioning the authorized local reference")
    model.prepare_conditionals(str(reference))
    return ModelRuntime(model, int(model.sr))


class Handler(BaseHTTPRequestHandler):
    server_version = "VoxChatterbox/1"

    @property
    def runtime(self) -> ModelRuntime:
        return self.server.runtime  # type: ignore[attr-defined]

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _json(self, status: int, value: dict[str, Any]) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("request body is too large")
        raw = self.rfile.read(length)
        value = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(value, dict):
            raise ValueError("request body must be a JSON object")
        return value

    def do_GET(self) -> None:
        if self.path != "/health":
            self._json(404, {"error": "not found"})
            return
        self._json(200, {"status": "ready", "device": "cpu", "nano": True})

    def do_POST(self) -> None:
        try:
            if self.path == "/synthesize":
                body = self._read_json()
                text = str(body.get("text", "")).strip()
                request_id = str(body.get("requestId", "")).strip()[:80]
                if not text or len(text) > MAX_TEXT_CHARS or not request_id:
                    raise ValueError("text and requestId are required")
                audio, elapsed_ms = self.runtime.synthesize(text, request_id)
                if audio is None:
                    self._json(409, {"error": "canceled", "requestId": request_id})
                    return
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(audio)))
                self.send_header("X-Vox-Synthesis-Ms", str(elapsed_ms))
                self.end_headers()
                self.wfile.write(audio)
                return
            if self.path == "/cancel":
                body = self._read_json()
                request_id = str(body.get("requestId", "")).strip()[:80]
                if request_id:
                    self.runtime.cancel(request_id)
                self._json(200, {"canceled": bool(request_id)})
                return
            if self.path == "/shutdown":
                self._json(200, {"stopping": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            self._json(404, {"error": "not found"})
        except (ValueError, json.JSONDecodeError) as error:
            self._json(400, {"error": str(error)})
        except BrokenPipeError:
            return
        except Exception as error:
            self._json(500, {"error": str(error)})


def create_server(host: str, port: int, runtime: ModelRuntime) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.runtime = runtime  # type: ignore[attr-defined]
    return server


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--voices-root", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--parent-pid", required=True, type=int)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.host != "127.0.0.1" or args.port < 0 or args.port > 65535:
        raise ValueError("sidecar must bind to 127.0.0.1 on a valid port")
    if args.threads < 1 or args.threads > 32:
        raise ValueError("threads must be from 1 to 32")
    if args.parent_pid < 1:
        raise ValueError("parent PID must be positive")

    began = time.perf_counter()
    for parent_pid in {args.parent_pid, os.getppid()}:
        if parent_pid > 0:
            threading.Thread(
                target=watch_parent_process,
                args=(parent_pid,),
                daemon=True,
            ).start()
    reference = validate_reference(args.reference, args.voices_root)
    cache = Path(args.cache).resolve(strict=False)
    runtime = load_runtime(reference, cache, args.threads)
    server = create_server(args.host, args.port, runtime)

    def stop(_signum: int, _frame: Any) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, stop)
    model_load_ms = round((time.perf_counter() - began) * 1000)
    emit(
        "ready",
        port=server.server_address[1],
        modelLoadMs=model_load_ms,
        referencePath=str(reference),
    )
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit("error", error=str(exc))
        raise
