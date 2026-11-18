// The 808's instrument tracks as the plugin plays them: each track's sound,
// the MIDI note that triggers it and where it sits in the mix.
//
// Mirrors machines/808/data/machine-808.json and roles.json, which are
// the source of truth. The self-test compares this table with those files.
#pragma once

#include <boombapbot/engine.h>

#include <array>

namespace snare::plugin {

struct TrackSpec {
  const char* id;
  int track;  // engine track, 1 to 11
  int sound;  // sound number, which is also its slot
  int gmNote;
  float trim;
  float pan;
  int chokeGroup;
};

// The two hi-hats share choke group 1.
inline constexpr std::array<TrackSpec, SNARE_TRACKS - 1> kTracks{{
    {"kick", 1, SNARE_SOUND_KICK, 36, 0.85f, 0.0f, 0},
    {"snare", 2, SNARE_SOUND_SNARE, 38, 0.75f, 0.0f, 0},
    {"low_tom", 3, SNARE_SOUND_LOW_TOM, 45, 0.7f, -0.3f, 0},
    {"mid_tom", 4, SNARE_SOUND_MID_TOM, 47, 0.7f, 0.0f, 0},
    {"high_tom", 5, SNARE_SOUND_HIGH_TOM, 50, 0.7f, 0.3f, 0},
    {"rim_shot", 6, SNARE_SOUND_RIM_SHOT, 37, 0.7f, 0.15f, 0},
    {"clap", 7, SNARE_SOUND_CLAP, 39, 0.8f, 0.0f, 0},
    {"cowbell", 8, SNARE_SOUND_COWBELL, 56, 0.6f, -0.15f, 0},
    {"cymbal", 9, SNARE_SOUND_CYMBAL, 49, 0.55f, 0.1f, 0},
    {"open_hat", 10, SNARE_SOUND_OPEN_HAT, 46, 0.4f, 0.2f, 1},
    {"closed_hat", 11, SNARE_SOUND_CLOSED_HAT, 42, 0.4f, 0.2f, 1},
}};

// The panel as a new project leaves it: every sound knob at its centre, the
// accent and master volume knobs at three quarters. The gains follow
// machines/808/src/document/machine.ts.
inline constexpr float kKnobCentre = 0.5f;
inline constexpr double kPlainGain = 0.6;
inline constexpr double kAccentGain = 0.9;
inline constexpr double kMasterVolume = 0.6495190528383290;  // 0.75 to the power 1.5

// The machine has two loudnesses, so a note is an accented hit from this
// velocity up. It sits between the velocities the editor's MIDI export writes
// for a plain hit (76) and an accented one (114 with the accent knob as above).
inline constexpr int kAccentVelocity = 96;

}  // namespace snare::plugin
