"""Streaming faster-whisper worker.

Reads raw 16 kHz mono s16le PCM from stdin, transcribes it in ~chunk-second
windows cut at the quietest moment near the window end, and writes one JSON
line per segment to stdout: {"start": float, "end": float, "text": str}, with
timestamps in seconds from the start of the stream. Diagnostics go to stderr.
"""

import argparse
import json
import sys
import time

import numpy as np
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2
READ_SECONDS = 0.5
# Where to look for a quiet cut point, and the frame size used to measure it.
SEARCH_SECONDS = 2.0
FRAME_SECONDS = 0.2
PROMPT_CHARS = 200
LAG_WARN_INTERVAL_SECONDS = 30.0


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def find_cut(samples: np.ndarray) -> int:
    """Index to cut `samples` at: the end of the quietest frame in the tail."""
    frame = int(FRAME_SECONDS * SAMPLE_RATE)
    search_start = max(0, len(samples) - int(SEARCH_SECONDS * SAMPLE_RATE))
    best_end, best_rms = len(samples), float("inf")
    for start in range(search_start, len(samples) - frame + 1, frame):
        window = samples[start : start + frame]
        rms = float(np.sqrt(np.mean(window * window)))
        if rms < best_rms:
            best_end, best_rms = start + frame, rms
    return best_end


class Transcriber:
    def __init__(self, model: WhisperModel, language: str | None) -> None:
        self.model = model
        self.language = language
        self.prompt = ""

    def transcribe(self, samples: np.ndarray, offset: float) -> None:
        segments, info = self.model.transcribe(
            samples,
            language=self.language,
            vad_filter=True,
            initial_prompt=self.prompt or None,
        )
        texts = []
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            texts.append(text)
            line = {
                "start": round(offset + segment.start, 2),
                "end": round(offset + segment.end, 2),
                "text": text,
            }
            print(json.dumps(line, ensure_ascii=False), flush=True)
        if texts:
            if self.language is None:
                # Lock the language after the first chunk with speech, so later
                # short or noisy chunks cannot flip it.
                self.language = info.language
                log(f"detected language: {info.language}")
            self.prompt = " ".join([self.prompt, *texts])[-PROMPT_CHARS:]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default=None)
    parser.add_argument("--chunk", type=float, default=8.0)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()
    if args.chunk <= SEARCH_SECONDS:
        parser.error(f"--chunk must be greater than {SEARCH_SECONDS}")

    log(f"loading model {args.model} ({args.device}, {args.compute_type})")
    model = WhisperModel(
        args.model, device=args.device, compute_type=args.compute_type
    )
    log("model ready")
    transcriber = Transcriber(model, args.language)

    read_bytes = int(READ_SECONDS * SAMPLE_RATE) * BYTES_PER_SAMPLE
    chunk_samples = int(args.chunk * SAMPLE_RATE)
    pending = bytearray()
    buffer = np.zeros(0, dtype=np.float32)
    offset = 0.0
    started_at: float | None = None
    last_lag_warning = 0.0

    while data := sys.stdin.buffer.read(read_bytes):
        if started_at is None:
            started_at = time.monotonic()
        pending.extend(data)
        # Keep an odd trailing byte for the next read.
        usable = len(pending) - len(pending) % BYTES_PER_SAMPLE
        pcm = np.frombuffer(bytes(pending[:usable]), dtype=np.int16)
        del pending[:usable]
        buffer = np.concatenate([buffer, pcm.astype(np.float32) / 32768.0])

        if len(buffer) < chunk_samples:
            continue
        cut = find_cut(buffer)
        transcriber.transcribe(buffer[:cut], offset)
        offset += cut / SAMPLE_RATE
        buffer = buffer[cut:]

        # For a live source, wall time since the first byte is how much audio
        # exists; if we have processed much less, we are falling behind.
        now = time.monotonic()
        lag = (now - started_at) - offset
        if lag > 2 * args.chunk and now - last_lag_warning > LAG_WARN_INTERVAL_SECONDS:
            log(f"{lag:.0f}s behind real time; on a live stream try a smaller --model")
            last_lag_warning = now

    if len(buffer) > 0:
        transcriber.transcribe(buffer, offset)


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, BrokenPipeError):
        # The consumer went away (Ctrl+C or it stopped reading); exit quietly.
        sys.exit(0)
