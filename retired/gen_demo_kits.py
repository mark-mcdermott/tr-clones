#!/usr/bin/env python3
"""Generates the demo drum kits kept for the 606, 707 and 909.

Every sound is synthesised here from oscillators and a seeded noise source.
Nothing is sampled from a real instrument or from any recording. The kits are
loosely voiced after the character of those machines. Nothing loads them: a
machine here synthesises its own sounds, as the 808 does
(machines/808/engine/voices.cpp). They stay, with their check, for when those
machines are built.

Uses only the Python standard library. Output is 16-bit mono PCM at 44.1 kHz.

    python3 retired/gen_demo_kits.py            # write retired/kits/<kit>/*.wav
    python3 retired/gen_demo_kits.py --check    # compare against committed files
"""

from __future__ import annotations

import argparse
import math
import os
import struct
import sys
import wave

SR = 44100
PEAK = 0.89
# Files are compared with this tolerance because the last bit of libm results
# can differ between platforms.
CHECK_TOLERANCE_LSB = 1


# --------------------------------------------------------------------------
# Signal helpers
# --------------------------------------------------------------------------

class Lcg:
    """Small deterministic noise source, independent of Python's `random`."""

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFF

    def next(self) -> float:
        self.state = (self.state * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.state / 2147483648.0 - 1.0


def frames(seconds: float) -> int:
    return int(round(seconds * SR))


def noise(n: int, seed: int) -> list[float]:
    source = Lcg(seed)
    return [source.next() for _ in range(n)]


def decay(n: int, seconds: float) -> list[float]:
    """Exponential decay from 1 with the given time constant."""
    k = math.exp(-1.0 / (seconds * SR))
    out = []
    value = 1.0
    for _ in range(n):
        out.append(value)
        value *= k
    return out


def sweep(n: int, start_hz: float, end_hz: float, sweep_seconds: float) -> list[float]:
    """Sine whose pitch falls exponentially from start_hz to end_hz."""
    out = []
    phase = 0.0
    k = math.exp(-1.0 / (sweep_seconds * SR))
    delta = start_hz - end_hz
    two_pi_over_sr = 2.0 * math.pi / SR
    for _ in range(n):
        out.append(math.sin(phase))
        phase += (end_hz + delta) * two_pi_over_sr
        delta *= k
    return out


def squares(n: int, freqs: list[float]) -> list[float]:
    """Sum of naive square waves. Their aliasing is part of the metallic tone."""
    out = [0.0] * n
    scale = 1.0 / len(freqs)
    for index, freq in enumerate(freqs):
        phase = 0.137 * index
        step = freq / SR
        for i in range(n):
            out[i] += scale if (phase % 1.0) < 0.5 else -scale
            phase += step
    return out


def biquad(x: list[float], b0: float, b1: float, b2: float, a1: float, a2: float) -> list[float]:
    out = []
    x1 = x2 = y1 = y2 = 0.0
    for sample in x:
        y = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, sample
        y2, y1 = y1, y
        out.append(y)
    return out


def _rbj(freq: float, q: float) -> tuple[float, float, float]:
    w0 = 2.0 * math.pi * min(freq, SR * 0.45) / SR
    return math.cos(w0), math.sin(w0), math.sin(w0) / (2.0 * q)


def lowpass(x: list[float], freq: float, q: float = 0.707) -> list[float]:
    cos_w, _, alpha = _rbj(freq, q)
    a0 = 1.0 + alpha
    return biquad(x, (1 - cos_w) / 2 / a0, (1 - cos_w) / a0, (1 - cos_w) / 2 / a0,
                  -2 * cos_w / a0, (1 - alpha) / a0)


def highpass(x: list[float], freq: float, q: float = 0.707) -> list[float]:
    cos_w, _, alpha = _rbj(freq, q)
    a0 = 1.0 + alpha
    return biquad(x, (1 + cos_w) / 2 / a0, -(1 + cos_w) / a0, (1 + cos_w) / 2 / a0,
                  -2 * cos_w / a0, (1 - alpha) / a0)


def bandpass(x: list[float], freq: float, q: float) -> list[float]:
    cos_w, _, alpha = _rbj(freq, q)
    a0 = 1.0 + alpha
    return biquad(x, alpha / a0, 0.0, -alpha / a0, -2 * cos_w / a0, (1 - alpha) / a0)


def gain(x: list[float], amount: float) -> list[float]:
    return [sample * amount for sample in x]


def shape(x: list[float], envelope: list[float]) -> list[float]:
    return [a * b for a, b in zip(x, envelope)]


def mix(*signals: list[float]) -> list[float]:
    n = max(len(s) for s in signals)
    out = [0.0] * n
    for signal in signals:
        for i, sample in enumerate(signal):
            out[i] += sample
    return out


def saturate(x: list[float], drive: float) -> list[float]:
    norm = math.tanh(drive)
    return [math.tanh(sample * drive) / norm for sample in x]


def crush(x: list[float], bits: int, hold: int) -> list[float]:
    """Lower bit depth and sample-and-hold, for an early-sampler grain."""
    levels = float(1 << (bits - 1))
    out = []
    held = 0.0
    for i, sample in enumerate(x):
        if i % hold == 0:
            held = math.floor(sample * levels + 0.5) / levels
        out.append(held)
    return out


def burst_envelope(n: int, count: int, spacing: float, burst_decay: float,
                   tail_decay: float) -> list[float]:
    """Several short bursts followed by a decaying tail, as in a hand clap."""
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        index = int(t / spacing)
        if index < count:
            out[i] = math.exp(-(t - index * spacing) / burst_decay)
        else:
            out[i] = math.exp(-(t - count * spacing) / tail_decay)
    return out


def finish(x: list[float], fade_ms: float = 6.0) -> list[float]:
    """Remove DC, normalise to the shared peak and fade the end to zero."""
    mean = sum(x) / len(x)
    x = [sample - mean for sample in x]
    peak = max(abs(sample) for sample in x) or 1.0
    x = [sample * PEAK / peak for sample in x]
    fade = min(len(x), int(fade_ms * SR / 1000.0))
    for i in range(fade):
        x[len(x) - 1 - i] *= i / fade
    return x


# --------------------------------------------------------------------------
# Voices
# --------------------------------------------------------------------------

def kick(length: float, start: float, end: float, sweep_s: float, amp_decay: float,
         click: float, drive: float, seed: int) -> list[float]:
    n = frames(length)
    body = shape(sweep(n, start, end, sweep_s), decay(n, amp_decay))
    tick = shape(lowpass(noise(n, seed), 3500.0), decay(n, 0.0025))
    out = mix(body, gain(tick, click))
    return saturate(out, drive) if drive > 0 else out


def snare(length: float, tones: list[tuple[float, float, float]], noise_hp: float,
          noise_lp: float, noise_decay: float, noise_level: float, drive: float,
          seed: int) -> list[float]:
    n = frames(length)
    parts = []
    for freq, tone_decay, level in tones:
        parts.append(gain(shape(sweep(n, freq * 1.6, freq, 0.012), decay(n, tone_decay)), level))
    rattle = lowpass(highpass(noise(n, seed), noise_hp), noise_lp)
    parts.append(gain(shape(rattle, decay(n, noise_decay)), noise_level))
    out = mix(*parts)
    return saturate(out, drive) if drive > 0 else out


def metal(length: float, freqs: list[float], hp: float, bp: float, bp_q: float,
          amp_decay: float, noise_level: float, seed: int,
          slow_decay: float = 0.0, slow_level: float = 0.0) -> list[float]:
    n = frames(length)
    tone = squares(n, freqs)
    if noise_level > 0:
        tone = mix(tone, gain(noise(n, seed), noise_level))
    tone = highpass(bandpass(tone, bp, bp_q), hp)
    envelope = decay(n, amp_decay)
    if slow_level > 0:
        slow = decay(n, slow_decay)
        envelope = [a * (1 - slow_level) + b * slow_level for a, b in zip(envelope, slow)]
    return shape(tone, envelope)


def tom(length: float, start: float, end: float, sweep_s: float, amp_decay: float,
        noise_level: float, drive: float, seed: int) -> list[float]:
    n = frames(length)
    body = shape(sweep(n, start, end, sweep_s), decay(n, amp_decay))
    skin = shape(lowpass(noise(n, seed), 1800.0), decay(n, 0.012))
    out = mix(body, gain(skin, noise_level))
    return saturate(out, drive) if drive > 0 else out


def clap(length: float, centre: float, q: float, hp: float, count: int, spacing: float,
         tail_decay: float, seed: int) -> list[float]:
    n = frames(length)
    body = highpass(bandpass(noise(n, seed), centre, q), hp)
    return shape(body, burst_envelope(n, count, spacing, 0.006, tail_decay))


# --------------------------------------------------------------------------
# Kits
# --------------------------------------------------------------------------

def kit_606() -> dict[str, list[float]]:
    hat = [245.0, 306.0, 365.0, 415.0, 437.0, 619.0]
    return {
        "kick": kick(0.26, 130, 62, 0.012, 0.07, 0.25, 0, 6061),
        "snare": snare(0.17, [(240, 0.035, 0.8), (410, 0.03, 0.4)], 3000, 12000, 0.05, 0.9, 0, 6062),
        "closed_hat": metal(0.06, hat, 8000, 10500, 1.4, 0.012, 0.0, 6063),
        "open_hat": metal(0.42, hat, 8000, 10500, 1.4, 0.11, 0.0, 6064),
        "low_tom": tom(0.30, 150, 125, 0.015, 0.08, 0.15, 0, 6065),
        "high_tom": tom(0.25, 245, 205, 0.012, 0.06, 0.15, 0, 6066),
        # The 606 has no clap. This slot holds a brighter, accented snare.
        "clap": snare(0.20, [(255, 0.03, 0.7), (520, 0.025, 0.5)], 4500, 14000, 0.07, 1.2, 0, 6067),
        "cymbal": metal(0.90, hat, 7000, 9000, 0.8, 0.3, 0.15, 6068),
    }


def kit_707() -> dict[str, list[float]]:
    hat = [330.0, 510.0, 690.0, 870.0, 1130.0, 1390.0]

    def lofi(x: list[float], bits: int = 10) -> list[float]:
        return crush(x, bits, 2)

    return {
        "kick": lofi(mix(kick(0.32, 150, 60, 0.02, 0.11, 0.2, 0, 7071),
                         gain(shape(bandpass(noise(frames(0.32), 7079), 2500, 1.2),
                                    decay(frames(0.32), 0.008)), 0.5))),
        "snare": lofi(snare(0.22, [(205, 0.06, 0.9)], 400, 7000, 0.1, 1.0, 0, 7072)),
        "closed_hat": lofi(metal(0.08, hat, 5500, 8000, 0.8, 0.016, 1.2, 7073), 9),
        "open_hat": lofi(metal(0.50, hat, 5500, 8000, 0.8, 0.14, 1.2, 7074), 9),
        "low_tom": lofi(tom(0.40, 170, 120, 0.05, 0.13, 0.35, 0, 7075)),
        "high_tom": lofi(tom(0.30, 280, 200, 0.04, 0.10, 0.35, 0, 7076)),
        "clap": lofi(clap(0.25, 1700, 1.5, 600, 3, 0.013, 0.05, 7077)),
        "cymbal": lofi(metal(1.20, hat, 4500, 6500, 0.6, 0.4, 2.0, 7078), 9),
    }


def kit_909() -> dict[str, list[float]]:
    hat = [320.0, 492.0, 550.0, 728.0, 912.0, 1210.0]
    return {
        "kick": kick(0.50, 260, 52, 0.045, 0.16, 0.6, 2.5, 9091),
        "snare": snare(0.35, [(190, 0.08, 0.7), (286, 0.06, 0.4)], 800, 9000, 0.13, 1.3, 1.6, 9092),
        "closed_hat": crush(metal(0.10, hat, 5000, 8500, 0.9, 0.022, 0.9, 9093), 8, 1),
        "open_hat": crush(metal(0.70, hat, 5000, 8500, 0.9, 0.2, 0.9, 9094), 8, 1),
        "low_tom": tom(0.60, 210, 105, 0.04, 0.2, 0.2, 1.8, 9095),
        "high_tom": tom(0.45, 370, 185, 0.035, 0.14, 0.2, 1.8, 9096),
        "clap": clap(0.45, 1400, 0.9, 500, 4, 0.009, 0.11, 9097),
        "cymbal": crush(metal(1.60, hat, 6000, 8000, 0.6, 0.55, 1.5, 9098), 8, 1),
    }


KITS = {"606": kit_606, "707": kit_707, "909": kit_909}


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def to_pcm16(x: list[float]) -> list[int]:
    out = []
    for sample in x:
        value = int(math.floor(sample * 32767.0 + 0.5))
        out.append(max(-32768, min(32767, value)))
    return out


def write_wav(path: str, pcm: list[int]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SR)
        out.writeframes(struct.pack("<%dh" % len(pcm), *pcm))


def read_wav(path: str) -> list[int]:
    with wave.open(path, "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != SR:
            raise ValueError("unexpected format in %s" % path)
        raw = source.readframes(source.getnframes())
    return list(struct.unpack("<%dh" % (len(raw) // 2), raw))


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=os.path.join(here, "kits"))
    parser.add_argument("--check", action="store_true",
                        help="regenerate in memory and compare with the files on disk")
    args = parser.parse_args()

    failures = 0
    for kit_id, build in KITS.items():
        for role, signal in build().items():
            pcm = to_pcm16(finish(signal))
            path = os.path.join(args.out, kit_id, role + ".wav")
            if args.check:
                try:
                    existing = read_wav(path)
                except (OSError, ValueError, wave.Error) as error:
                    print("MISSING  %s (%s)" % (path, error))
                    failures += 1
                    continue
                worst = max((abs(a - b) for a, b in zip(pcm, existing)), default=0)
                if len(existing) != len(pcm) or worst > CHECK_TOLERANCE_LSB:
                    print("DIFFERS  %s (length %d vs %d, max difference %d LSB)"
                          % (path, len(existing), len(pcm), worst))
                    failures += 1
                else:
                    print("ok       %s" % os.path.relpath(path, root))
            else:
                write_wav(path, pcm)
                print("wrote    %s  %.3fs" % (os.path.relpath(path, root), len(pcm) / SR))

    if args.check and failures:
        print("%d file(s) do not match retired/gen_demo_kits.py" % failures)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
