"""Optional, local-only ASR comparison. Requires sherpa-onnx and numpy.

Usage: python scripts/evaluate-small-speech-model.py MODEL_DIRECTORY [WAV ...]
Downloads and model replacement are deliberately separate from evaluation.
"""
import json
from pathlib import Path
import sys
import time
import wave

import numpy as np
import sherpa_onnx


def main():
    root = Path(sys.argv[1])
    recognizer = sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc(
        tokens=str(root / "tokens.txt"),
        model=str(root / "zipformer-ctc.int8.onnx"),
        num_threads=2,
    )
    paths = [Path(arg) for arg in sys.argv[2:]] or sorted(root.glob("*.wav"))
    for path in paths:
        with wave.open(str(path)) as source:
            if source.getnchannels() != 1 or source.getsampwidth() != 2:
                raise ValueError("Evaluation WAV must be mono signed 16-bit PCM")
            rate = source.getframerate()
            samples = np.frombuffer(source.readframes(source.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        start = time.perf_counter()
        stream = recognizer.create_stream()
        stream.accept_waveform(rate, samples)
        stream.accept_waveform(rate, np.zeros(int(rate * 0.66), dtype=np.float32))
        stream.input_finished()
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        elapsed = time.perf_counter() - start
        print(json.dumps({"file": path.name, "durationSeconds": len(samples) / rate,
                          "elapsedSeconds": round(elapsed, 3), "text": recognizer.get_result(stream)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
