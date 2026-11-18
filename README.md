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
  tests. A machine is one folder; the next one goes beside it.
- **`apps/host/`** is one page that mounts the editor with a machine. There
  is no server behind it, so there are no accounts and nothing is saved
  anywhere but in the browser.
- **`scripts/`** builds the engine for the machines here and puts it where
  the page can serve it.

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

```bash
pnpm build:engine    # builds and runs the engine's test suites
pnpm typecheck
pnpm test:unit       # needs build:engine and build:wasm first
pnpm faceplates:check
pnpm build           # the page, into apps/host/dist
```

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

- The 808's browser tests, which are still in boombapbot.
- The VST3 spike and the retired kits and photographs of the 606, 707 and
  909, which are also still in boombapbot.
- Any machine but the 808.

## What has and has not been checked

The 808 here builds, passes the engine's test suites and its own unit tests,
renders the same audio and MIDI as it does in boombapbot, and plays in
Chromium from `pnpm build`. It has not been run in Safari or Firefox or on a
phone from this repository, and there is no CI here yet.
