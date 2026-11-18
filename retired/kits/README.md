# Demo kits

These three kits are **placeholders that nothing loads**. A machine here
synthesises its own sounds from its knobs (`machines/<id>/engine/voices.cpp`),
the 606, the 707 and the 909 included, so there are no 808 files here. The
three kits are from before those machines were built, and are kept with
their check.

Every file is synthesised by
[`retired/gen_demo_kits.py`](../gen_demo_kits.py) from sine sweeps,
naive square oscillators and a seeded noise generator, using only the Python
standard library.

- Nothing here is sampled from a TR-606, TR-707 or TR-909, or from any other
  instrument or recording.
- The kits are voiced only loosely after the character of those machines.
  They are not emulations.
- Format: 16-bit mono PCM WAV at 44.1 kHz, normalised to a peak of 0.89.
- Author: generated for this repository. No third-party material.

## Regenerating

```bash
pnpm kits:generate   # rewrite retired/kits/<kit>/*.wav
pnpm kits:check      # confirm the committed files match the generator
```

The check allows a difference of one 16-bit step, because the last bit of
`math.sin` and `math.exp` can differ between platforms.

## Using them again

Nothing reads these files today, and no machine here plays samples.

Before licensed recordings are committed, record their rights and provenance
here, per file.
