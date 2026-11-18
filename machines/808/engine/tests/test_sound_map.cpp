// The contract files the engine shares with the editor: sound slots, the
// machine's tracks, and the fixture project rendered through both.

#include <cstring>
#include <set>
#include <string>
#include <vector>

#include "../tools/project_io.h"
#include "test_util.h"

using namespace snare::test;

namespace {

const std::string kContracts = SNARE_MACHINE_DIR;
const std::string kFixture = kContracts + "/fixtures/mixed-rhythms.project.json";

}  // namespace

SNARE_TEST(sound_slots_keep_their_numbers) {
  const snare::io::Roles roles = snare::io::loadRoles(kContracts);
  CHECK_EQ(roles.ids.size(), static_cast<std::size_t>(SNARE_SOUNDS));
  // The first eight are where they have always been; the rest were appended.
  const char* expected[SNARE_SOUNDS] = {"kick",    "snare",     "closed_hat", "open_hat",  "low_tom",   "high_tom",
                                        "clap",    "cymbal",    "mid_tom",    "rim_shot",  "cowbell",   "low_conga",
                                        "mid_conga", "high_conga", "claves",   "maracas"};
  for (int slot = 0; slot < SNARE_SOUNDS; ++slot) {
    CHECK(roles.ids[static_cast<std::size_t>(slot)] == expected[slot]);
  }
  CHECK_EQ(roles.indexById.at("kick"), SNARE_SOUND_KICK);
  CHECK_EQ(roles.indexById.at("cowbell"), SNARE_SOUND_COWBELL);
  CHECK_EQ(roles.indexById.at("maracas"), SNARE_SOUND_MARACAS);
  CHECK_EQ(roles.gmNotes[SNARE_SOUND_KICK], 36);
  CHECK_EQ(roles.gmNotes[SNARE_SOUND_CLAVES], 75);
}

SNARE_TEST(the_machine_has_an_accent_and_eleven_instruments_covering_every_sound) {
  const snare::io::Roles roles = snare::io::loadRoles(kContracts);
  const snare::io::Machine machine = snare::io::loadMachine(kContracts, roles);
  CHECK_EQ(machine.tracks.size(), static_cast<std::size_t>(SNARE_TRACKS));
  CHECK(machine.tracks[0].id == "accent");
  CHECK_EQ(machine.tracks[0].sound, -1);
  std::set<int> slots;
  int alternates = 0;
  for (int track = 1; track < SNARE_TRACKS; ++track) {
    const snare::io::Track& entry = machine.tracks[static_cast<std::size_t>(track)];
    CHECK(entry.sound >= 0);
    slots.insert(entry.sound);
    if (entry.alternate >= 0) {
      slots.insert(entry.alternate);
      ++alternates;
    }
  }
  CHECK_EQ(alternates, 5);
  CHECK_EQ(slots.size(), static_cast<std::size_t>(SNARE_SOUNDS));
  // The hats share a choke group and nothing else has one.
  CHECK_EQ(machine.tracks[10].chokeGroup, machine.tracks[11].chokeGroup);
  CHECK(machine.tracks[10].chokeGroup != 0);
  CHECK_EQ(machine.tracks[1].chokeGroup, 0);
}

SNARE_TEST(the_fixture_loads_into_patterns) {
  const snare::io::Roles roles = snare::io::loadRoles(kContracts);
  const snare::io::Machine machine = snare::io::loadMachine(kContracts, roles);
  const snare::io::Project project = snare::io::loadProject(kFixture, machine);
  CHECK_NEAR(project.bpm, 124.0, 0.01);
  CHECK_EQ(snare_pattern_ticks(&project.patterns[0]), 96);
  CHECK_EQ(snare_pattern_ticks(&project.patterns[2]), 96);   // twelve triplet steps
  CHECK_EQ(snare_pattern_ticks(&project.patterns[4]), 96);   // thirty-two thirty-seconds
  CHECK_EQ(snare_pattern_ticks(&project.patterns[6]), 96);   // twenty-four sextuplets
  CHECK_EQ(project.patterns[0].rows[0], 0x101u);             // accents on steps 1 and 9
  CHECK_EQ(project.patterns[4].rows[6], 0xc0000000u);        // rim shots on the last two steps
  CHECK_EQ(project.rhythmTracks.size(), 12u);
  CHECK_EQ(project.rhythmTracks[0].size(), 7u);
  // The rim shot track is switched to claves; the clap is not switched.
  CHECK_EQ(snare::io::trackSlot(machine, project, machine.indexById.at("rim_shot")), SNARE_SOUND_CLAVES);
  CHECK_EQ(snare::io::trackSlot(machine, project, machine.indexById.at("clap")), SNARE_SOUND_CLAP);
  CHECK_NEAR(snare::io::levelGain(machine.tracks[1], 0.75), machine.tracks[1].trim, 1e-9);
}

SNARE_TEST(every_rhythm_of_the_fixture_renders_its_hits_the_same_way_twice) {
  const snare::io::Roles roles = snare::io::loadRoles(kContracts);
  const snare::io::Machine machine = snare::io::loadMachine(kContracts, roles);
  const snare::io::Project project = snare::io::loadProject(kFixture, machine);
  for (int index : {0, 1, 2, 4, 6, 24}) {
    std::vector<float> runs[2];
    const SnarePattern& pattern = project.patterns[index];
    int hits = 0;
    for (int played = 0; played < pattern.len1 + pattern.len2; ++played) {
      const int step = played < pattern.len1 ? played : SNARE_PART_STEPS + played - pattern.len1;
      for (int track = 1; track < SNARE_TRACKS; ++track) hits += (pattern.rows[track] >> step) & 1u;
    }
    for (auto& run : runs) {
      SnareEngine* engine = snare_engine_create(44100.0);
      snare_engine_enable_event_log(engine, 4096);
      snare::io::applyProject(engine, machine, project);
      run = snare::io::renderLoop(engine, pattern, index, project.bpm, 44100.0).left;
      CHECK_EQ(snare_engine_event_count(engine), hits * 2);  // the loop is the second of two passes
      CHECK_EQ(snare_engine_stolen_voices(engine), 0u);
      snare_engine_destroy(engine);
    }
    CHECK(hits > 0);
    double sum = 0.0;
    for (float sample : runs[0]) {
      CHECK(std::fabs(sample) <= 1.0f);
      sum += static_cast<double>(sample) * sample;
    }
    CHECK(std::sqrt(sum / static_cast<double>(runs[0].size())) > 0.01);
    CHECK(std::memcmp(runs[0].data(), runs[1].data(), sizeof(float) * runs[0].size()) == 0);
  }
}

SNARE_TEST_MAIN()
