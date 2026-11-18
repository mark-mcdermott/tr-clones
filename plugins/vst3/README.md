# boombapbot VST3 compile spike

A minimal VST3 instrument that links the shared render engine (`core/engine/`) into a
JUCE plugin and plays the 808's synthesised sounds from MIDI notes. It exists to
prove the engine's C ABI works inside a plugin build. It is not a product.

## What it does

- Instrument with MIDI input and one stereo output. No audio input, no MIDI output.
- "MIDI Trigger" only: a note-on on any channel plays one hit of the matching
  track. Notes follow General MIDI, as in `machines/808/data/roles.json`:

  | Note | Track | Note | Track |
  | --- | --- | --- | --- |
  | 36 | bass drum | 39 | hand clap |
  | 38 | snare drum | 56 | cowbell |
  | 45 | low tom | 49 | cymbal |
  | 47 | mid tom | 46 | open hi-hat |
  | 50 | hi tom | 42 | closed hi-hat |
  | 37 | rim shot | | |

  Other notes, note-offs and all other MIDI messages are ignored. The congas,
  claves and maracas are behind voice switches the plugin does not have yet.
- The machine has two loudnesses, so velocity picks one: 96 and above is an
  accented hit, anything lower a plain one. That threshold sits between the
  two velocities the editor's MIDI export writes.
- Hits land on the note's sample offset inside the block. The engine applies
  queued triggers at the start of a render call, so `processBlock` splits the
  block at each note-on and renders the pieces in turn.
- The engine synthesises the eleven sounds in `prepareToPlay`, at the host's
  sample rate, with every sound knob at its centre. Nothing is read from disk
  and nothing is resampled. Trim, pan, choke group and note for each track are
  a small table in `Source/Machine808.h` that mirrors
  `machines/808/data/machine-808.json` and `roles.json`; those files are
  the source of truth and the self-test compares the table with them.
- The engine is created in `prepareToPlay` at the host sample rate and replaced
  if the rate changes. Outside the engine's 8 kHz–192 kHz range the plugin
  stays silent.
- State is a small XML blob: `<BoombapbotPluginState schemaVersion="2" machine="808"/>`.
  There are no parameters, so nothing in it is read back.
- No editor (`hasEditor()` is false), no parameters, no internal sequencer, no
  host sync.

## Build

From the repository root:

```sh
cmake -S plugins/vst3 -B build/vst3 -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build/vst3
```

The bundle is written to
`build/vst3/boombapbot_plugin_artefacts/Release/VST3/boombapbot.vst3`. It is not
copied into a system plugin folder (`COPY_PLUGIN_AFTER_BUILD FALSE`).

The same build also produces the processor self-test (see [Self-test](#self-test)).
It compiles the JUCE modules a second time, which roughly doubles the build.
Pass `-DSNARE_VST3_BUILD_SELFTEST=OFF` at configure time to leave it out; the
plugin target is the same either way.

JUCE 8.0.9 is cloned from GitHub at configure time with CMake `FetchContent`. It
is not vendored in this repository. To use a local checkout instead, add
`-DFETCHCONTENT_SOURCE_DIR_JUCE=/path/to/JUCE`.

Needs CMake 3.22 or newer, a C++20 compiler, Ninja (or another generator) and
network access to github.com for the first configure.

### Linux packages

On Ubuntu 24.04:

```sh
apt-get install -y --no-install-recommends \
  pkg-config libx11-dev libxext-dev libxrandr-dev libxinerama-dev libxcursor-dev \
  libfreetype-dev libfontconfig-dev libasound2-dev libgl1-mesa-dev
```

`libxrender-dev` comes in as a dependency of the X11 packages. In this build no
compiled file included an ALSA or OpenGL header and the plugin does not link
either library, so `libasound2-dev` and `libgl1-mesa-dev` are probably not
needed. A build without them installed was not tried.

`JUCE_WEB_BROWSER=0` and `JUCE_USE_CURL=0` are set, so WebKitGTK, GTK and
libcurl development packages are not needed. Configure prints "not found" for
them and carries on.

## Self-test

`Tests/ProcessorSelfTest.cpp` is a console program that compiles
`Source/PluginProcessor.cpp` directly and drives the processor the way a host
would, block by block, without the VST3 wrapper. After the build above:

```sh
ctest --test-dir build/vst3 --output-on-failure
```

It prints one line per check and exits non-zero if any check fails. To see the
lines of a passing run, add `-V` or run
`build/vst3/boombapbot_plugin_selftest_artefacts/Release/boombapbot_plugin_selftest`.

Run at 44.1, 48 and 96 kHz, each with block sizes 64 and 512:

- No MIDI gives exact silence.
- A kick at frame 100 gives exact zeros before it and its first non-zero sample
  at frame 100 on both channels.
- A kick at frame 10 and a snare at frame 40 in the same block: the output is
  bit-identical to the kick alone up to frame 40 and first differs at frame 40.
  This is the block-splitting path.
- Each of the eleven mapped notes makes sound, on a spread of MIDI channels. An
  unmapped note, a note-off and a note-on with velocity 0 give exact silence.
- Velocity 127 is louder than velocity 1, the change is at 96, and nothing
  else depends on velocity.
- A closed hat chokes a sounding open hat: the output is bit-identical to the
  open hat alone up to the closed hat's frame, 10 ms later it is bit-identical
  to the closed hat alone, and from 0.25 s to 0.35 s it is exact silence while
  an un-choked open hat is still sounding.

Run once:

- Re-preparing at a different sample rate still plays a hit on its frame, and
  a sample rate outside the engine's range gives silence.
- State is byte-for-byte identical after save, load, save. Garbage bytes, an
  empty block, XML of another type, a state from `schemaVersion` 1 and an
  unknown machine each leave the saved state unchanged, and the processor
  still plays afterwards. Nothing is read from a saved state yet, so these
  show only that bad input does no damage.
- The track table in `Source/Machine808.h` matches `machine-808.json` and
  `roles.json`, track by track.

## Licensing

JUCE 8 is licensed under AGPLv3 or a commercial JUCE licence. This spike does
not choose between them. A licensing path has to be chosen before any binary
built from it is distributed. The VST3 SDK that ships inside JUCE has its own
terms, which also have to be checked at that point.

## Verified

On one machine: macOS 26.6 on Apple silicon, Apple clang 21, CMake 4.4, Ninja.

- Configure and a Release build succeed from an empty build directory,
  including the JUCE clone.
- The build produces `boombapbot.vst3/Contents/MacOS/boombapbot`, an arm64 Mach-O
  bundle of about 8.3 MB, not stripped. It exports `GetPluginFactory`,
  `bundleEntry` and `bundleExit`, and contains the engine's `snare_engine_*`
  and `snare_synth_*` functions.
- JUCE's `juce_vst3_helper` loaded the built module and wrote
  `Contents/Resources/moduleinfo.json`.
- The plugin's sources and the self-test compile with no warnings of their own
  under JUCE's recommended warning flags. The 808's tool-side loader
  (`machines/808/engine/tools/project_io.h`) is built with fewer warnings than JUCE asks
  for, so they are switched off around that one include in the self-test.
  JUCE's own sources give a few warnings with this compiler.
- The self-test passes: `ctest --test-dir build/vst3 --output-on-failure`
  reports 1 of 1 tests passed, 179 checks with none failed. What it checks is
  listed under [Self-test](#self-test).

An earlier version of the spike, which played sample files, was built and
tested the same way on Ubuntu 24.04 with g++ 13.3. This version has not been
built on Linux; CI does that.

## Not verified

- A Windows build, and this version on Linux. An Intel or universal macOS
  build was not tried either.
- The `-DSNARE_VST3_BUILD_SELFTEST=OFF` and `-DFETCHCONTENT_SOURCE_DIR_JUCE`
  configurations, for this version.
- Loading or scanning in any host or DAW.
- The Steinberg VST3 validator.
- The audio path through the VST3 wrapper. The self-test calls the processor
  directly, so parameter, bus, MIDI and state handling inside JUCE's VST3
  wrapper are not exercised.
- State recall in a real host. The self-test round-trips the blob in process
  only.
- Transport sync. There is none: the spike has no sequencer and ignores the
  host's tempo and position.
- Automation. The plugin has no parameters.
- Real-time behaviour under a host: no measurement of CPU load, of dropouts, or
  of allocations on the audio thread. The code was written to avoid allocation,
  locks and file access in `processBlock`, and that was checked by reading it,
  not by a tool.
- Compilers other than Apple clang 21 for this version, and Debug builds.
