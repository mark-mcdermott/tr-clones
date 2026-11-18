// Loads the shared contract files (roles, the machine's tracks, projects) into
// engine structures. Used by tools and tests; the render core never parses.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstring>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

#include "json_min.h"
#include "boombapbot/engine.h"
#include "wav_io.h"

namespace snare::io {

struct Roles {
  std::map<std::string, int> indexById;
  std::vector<std::string> ids;       // by index
  std::vector<std::uint8_t> gmNotes;  // by index
};

inline Roles loadRoles(const std::string& machineDir) {
  const json::Value doc = json::parseFile(machineDir + "/data/roles.json");
  Roles roles;
  const auto& list = doc.at("roles").array;
  roles.ids.resize(list.size());
  roles.gmNotes.resize(list.size());
  for (const auto& role : list) {
    const int index = role.at("index").asInt();
    if (index < 0 || index >= static_cast<int>(list.size()) || index >= SNARE_SOUNDS) {
      throw std::runtime_error("role index out of range");
    }
    roles.indexById[role.at("id").string] = index;
    roles.ids[static_cast<std::size_t>(index)] = role.at("id").string;
    roles.gmNotes[static_cast<std::size_t>(index)] =
        static_cast<std::uint8_t>(role.at("gmNote").asInt());
  }
  return roles;
}

// One track of the machine, as data/machine-808.json describes it. Track 0 is
// the accent and plays nothing.
struct Track {
  std::string id;
  int sound = -1;      // slot it plays
  int alternate = -1;  // slot it plays with its voice switch thrown
  double trim = 1.0;
  float pan = 0.0f;
  int chokeGroup = 0;
};

struct Machine {
  std::vector<Track> tracks;
  std::map<std::string, int> indexById;
};

inline Machine loadMachine(const std::string& machineDir, const Roles& roles) {
  const json::Value doc = json::parseFile(machineDir + "/data/machine-808.json");
  Machine machine;
  const auto slot = [&roles](const json::Value& value) {
    const auto found = roles.indexById.find(value.string);
    if (found == roles.indexById.end()) throw std::runtime_error("machine names unknown sound " + value.string);
    return found->second;
  };
  for (const auto& entry : doc.at("tracks").array) {
    Track track;
    track.id = entry.at("id").string;
    if (entry.has("sound")) track.sound = slot(entry.at("sound"));
    if (entry.has("alternate")) track.alternate = slot(entry.at("alternate"));
    if (entry.has("trim")) track.trim = entry.at("trim").number;
    if (entry.has("pan")) track.pan = static_cast<float>(entry.at("pan").number);
    if (entry.has("chokeGroup")) track.chokeGroup = entry.at("chokeGroup").asInt();
    machine.indexById[track.id] = static_cast<int>(machine.tracks.size());
    machine.tracks.push_back(track);
  }
  if (machine.tracks.size() != SNARE_TRACKS) throw std::runtime_error("the machine must have twelve tracks");
  return machine;
}

struct Project {
  std::string name;
  double bpm = 120.0;
  double master = 0.75;
  double accent = 0.75;
  double levels[SNARE_TRACKS]{};
  SnareSoundParams knobs[SNARE_TRACKS]{};  // sound is filled in when applied
  bool alternates[SNARE_TRACKS]{};
  SnarePattern patterns[SNARE_PATTERNS]{};
  std::vector<std::vector<std::uint8_t>> rhythmTracks;  // rhythm numbers
};

inline std::uint32_t rowMask(const std::string& row) {
  if (row.size() != SNARE_MAX_STEPS) throw std::runtime_error("a row must have 32 steps");
  std::uint32_t mask = 0;
  for (int step = 0; step < SNARE_MAX_STEPS; ++step) {
    const char c = row[static_cast<std::size_t>(step)];
    if (c == 'x') {
      mask |= 1u << step;
    } else if (c != '.') {
      throw std::runtime_error("a row holds only x and .");
    }
  }
  return mask;
}

inline Project loadProject(const std::string& path, const Machine& machine) {
  const json::Value doc = json::parseFile(path);
  if (doc.at("format").string != "boombapbot.project" || doc.at("schemaVersion").asInt() != 2) {
    throw std::runtime_error("unsupported project document: " + path);
  }
  Project project;
  project.name = doc.at("name").string;
  const json::Value& tempo = doc.at("tempo");
  const double perStop = (SNARE_BPM_MAX - SNARE_BPM_MIN) / 39.0;
  project.bpm = SNARE_BPM_MIN + (tempo.at("coarse").number + tempo.at("fine").number) * perStop;
  if (project.bpm < SNARE_BPM_MIN) project.bpm = SNARE_BPM_MIN;
  if (project.bpm > SNARE_BPM_MAX) project.bpm = SNARE_BPM_MAX;

  const json::Value& sound = doc.at("sound");
  project.master = sound.at("master").number;
  project.accent = sound.at("accent").number;
  for (int track = 1; track < SNARE_TRACKS; ++track) {
    const std::string& id = machine.tracks[static_cast<std::size_t>(track)].id;
    project.levels[track] = sound.at("levels").at(id).number;
    const json::Value& knobs = sound.at("knobs").at(id);
    project.knobs[track] = SnareSoundParams{0, static_cast<float>(knobs.at("tune").number),
                                            static_cast<float>(knobs.at("tone").number),
                                            static_cast<float>(knobs.at("decay").number),
                                            static_cast<float>(knobs.at("snappy").number), 0};
    if (sound.at("alternates").has(id)) project.alternates[track] = sound.at("alternates").at(id).boolean;
  }

  const auto& rhythms = doc.at("rhythms").array;
  if (rhythms.size() * 2 != SNARE_PATTERNS) throw std::runtime_error("a project has sixteen rhythms");
  const int stepsPerBeat[5] = {0, 3, 6, 4, 8};
  for (std::size_t rhythm = 0; rhythm < rhythms.size(); ++rhythm) {
    const json::Value& entry = rhythms[rhythm];
    const int preScale = entry.at("preScale").asInt();
    if (preScale < 1 || preScale > 4) throw std::runtime_error("pre-scale out of range");
    const char* versions[2] = {"a", "b"};
    for (int version = 0; version < 2; ++version) {
      SnarePattern& pattern = project.patterns[rhythm * 2 + static_cast<std::size_t>(version)];
      pattern.len1 = static_cast<std::uint8_t>(entry.at("firstLength").asInt());
      pattern.len2 = static_cast<std::uint8_t>(entry.at("secondLength").asInt());
      pattern.steps_per_beat = static_cast<std::uint8_t>(stepsPerBeat[preScale]);
      for (int track = 0; track < SNARE_TRACKS; ++track) {
        const std::string& id = machine.tracks[static_cast<std::size_t>(track)].id;
        pattern.rows[track] = rowMask(entry.at(versions[version]).at(id).string);
      }
    }
  }
  for (const auto& track : doc.at("rhythmTracks").array) {
    std::vector<std::uint8_t> measures;
    for (const auto& rhythm : track.array) measures.push_back(static_cast<std::uint8_t>(rhythm.asInt()));
    project.rhythmTracks.push_back(measures);
  }
  return project;
}

// The level knob at its default gives a track its trim; fully left is silence.
inline double levelGain(const Track& track, double level) {
  const double turn = level / 0.75;
  return track.trim * turn * turn;
}

// Gains of a hit on a plain step and on an accented one, for the accent level
// knob. machines/808/src/document/machine.ts holds the same model.
constexpr double kPlainHit = 0.6;
inline double accentedHit(double accentLevel) { return kPlainHit + (1.0 - kPlainHit) * accentLevel; }

// A hit's gain as a MIDI velocity.
inline int midiVelocity(double gain) { return static_cast<int>(std::floor(gain * 127.0 + 0.5)); }

// The slot a track plays, given where its voice switch stands.
inline int trackSlot(const Machine& machine, const Project& project, int track) {
  const Track& entry = machine.tracks[static_cast<std::size_t>(track)];
  return project.alternates[track] && entry.alternate >= 0 ? entry.alternate : entry.sound;
}

// Sends a whole project to an engine: sounds, mix, tempo and every pattern.
inline void applyProject(SnareEngine* engine, const Machine& machine, const Project& project) {
  snare_engine_set_tempo(engine, project.bpm);
  snare_engine_set_accent(engine, kPlainHit, accentedHit(project.accent));
  snare_engine_set_master_volume(engine, std::pow(project.master, 1.5));
  for (int track = 1; track < SNARE_TRACKS; ++track) {
    const Track& entry = machine.tracks[static_cast<std::size_t>(track)];
    // A track's knobs shape both of its sounds.
    for (const int slot : {entry.sound, entry.alternate}) {
      if (slot < 0) continue;
      SnareSoundParams params = project.knobs[track];
      params.sound = slot;
      snare_engine_synth_sound(engine, &params);
    }
    snare_engine_set_track(engine, track, trackSlot(machine, project, track), entry.pan, entry.chokeGroup);
    snare_engine_set_track_level(engine, track, levelGain(entry, project.levels[track]));
  }
  for (int index = 0; index < SNARE_PATTERNS; ++index) {
    snare_engine_set_pattern(engine, index, &project.patterns[index]);
  }
}

struct Rendered {
  std::vector<float> left;
  std::vector<float> right;
};

// Renders `frames` frames in blocks of `blockSize`.
inline Rendered render(SnareEngine* engine, int frames, int blockSize = 256) {
  Rendered out;
  out.left.resize(static_cast<std::size_t>(frames));
  out.right.resize(static_cast<std::size_t>(frames));
  int done = 0;
  while (done < frames) {
    const int count = frames - done < blockSize ? frames - done : blockSize;
    snare_engine_render(engine, out.left.data() + done, out.right.data() + done, count);
    done += count;
  }
  return out;
}

// One seamless loop of a pattern: plays it twice and returns the second
// measure, so tails from the end of the measure wrap into its start.
inline Rendered renderLoop(SnareEngine* engine, const SnarePattern& pattern, int index, double bpm,
                           double sampleRate) {
  const int ticks = snare_pattern_ticks(&pattern);
  const int first = static_cast<int>(snare_tick_frame(ticks, bpm, sampleRate));
  const int both = static_cast<int>(snare_tick_frame(2.0 * ticks, bpm, sampleRate));
  snare_engine_cue_pattern(engine, index);
  snare_engine_play_measures(engine, 2);
  Rendered all = render(engine, both);
  Rendered out;
  out.left.assign(all.left.begin() + first, all.left.end());
  out.right.assign(all.right.begin() + first, all.right.end());
  return out;
}

}  // namespace snare::io
