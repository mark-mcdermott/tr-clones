# tr-clones

Drum machines built on [boombapbot](https://github.com/mark-mcdermott/boombapbot)'s
core. boombapbot is the product; this is where machines that are not part of
it live and are worked on. The first one here is the 808, which was
boombapbot's first machine.

Nothing here ships in boombapbot, and boombapbot does not know this
repository exists.

## How it fits together

- **`core/`** is boombapbot, as a git submodule pinned to one commit. It
  brings the engine (C++, built natively and to WebAssembly), the editor
  (React) and what every project document shares. This repository uses those
  and changes none of them.
- **`machines/808/`** is the 808 as a machine: its project document, its
  voices for the engine, its panel and its art, what its controls do, and its
  tests. Its `engine/` folder also holds its render tool, which plays an 808
  project through the native engine, and the engine tests that are about
  its sounds and data files. A machine is one folder; the next one goes
  beside it.
- **`apps/host/`** is one page that mounts the editor with a machine. There
  is no server behind it, so there are no accounts and nothing is saved
  anywhere but in the browser.
- **`e2e/`** is the browser tests: what every machine's tests share, and a
  folder of tests for each machine.
- **`plugins/vst3/`** is a JUCE VST3 instrument that links the same engine
  with the 808's voices. It is a compile spike, not a product; its own
  README says what was and was not verified.
- **`retired/`** holds things kept for machines that are not built yet:
  generated sample kits for the 606, 707 and 909 with their generator, and
  debranded Creative Commons photographs of four machines with their
  credits. Nothing loads or ships them.
- **`scripts/`** builds the engine for the machines here, puts it where the
  page can serve it, and measures its load (`pnpm bench`).

## Getting it running

Clone with the submodule, then install:

```bash
git clone --recurse-submodules https://github.com/mark-mcdermott/tr-clones.git
cd tr-clones
pnpm install
```

The engine has to be built once, and again whenever it or a machine's voices
change. It needs CMake, Ninja and a C++20 compiler, and the Emscripten the
core pins:

```bash
pnpm setup:emsdk     # once: installs Emscripten into core/.tools/emsdk
pnpm build:engine    # native engine and its tests, into build/native
pnpm build:wasm      # the same engine as WebAssembly, into build/wasm
```

Then:

```bash
pnpm dev             # http://localhost:4321
```

## Checks

In the order CI runs them:

```bash
pnpm kits:check        # the retired kits match their generator
pnpm faceplates:check  # the 808's drawn faceplate matches its generator
pnpm build:engine      # builds the engine and runs its test suites
pnpm build:wasm
pnpm typecheck
pnpm test:unit         # needs build:engine and build:wasm first
pnpm build             # the page, into apps/host/dist
pnpm test:e2e          # Playwright, against that build
```

`pnpm test:e2e` needs `pnpm exec playwright install chromium` once. The VST3
spike is built apart from all of this:

```bash
cmake -S plugins/vst3 -B build/vst3 -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build/vst3
ctest --test-dir build/vst3 --output-on-failure
```

`.github/workflows/ci.yml` runs the whole list on every push and pull
request, with the engine also built by Clang and under the sanitizers.

## Moving the core forward

`core/` stays where it is until it is moved on purpose:

```bash
git -C core fetch origin
git -C core checkout <commit>
git add core
```

After that, build the engine again and run the checks: the machines here are
written against the core's engine and editor, and a change there can break
them.

## What is not here yet

Any machine but the 808.

## What has and has not been checked

Run on macOS on Apple silicon: the 808 builds and passes the engine's test
suites, its own unit tests and its browser tests in headless Chromium, and
it renders the same audio and MIDI as it did in boombapbot, byte for byte.
The VST3 spike builds there and its self-test passes.

Not checked: Safari, Firefox or a phone from this repository; the VST3 in
any host; and the CI workflow, which has not run on GitHub yet.
