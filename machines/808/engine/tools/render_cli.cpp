// boombapbot-render: renders a project through the native engine. It gives the
// reference output that the WebAssembly build is compared against.
//
//   boombapbot-render --project beat.json --machine machines/808
//       [--rhythm 0] [--version a|b] [--rate 44100] [--bits 24]
//       [--out loop.wav] [--midi beat.mid] [--events events.json]
//       [--swing 0..128] [--effect delay|reverb|flanger|chorus] [--wet 0..1]
//
// It renders one measure of one rhythm as a seamless loop. It also writes one
// synthesised sound as raw little-endian float samples:
//
//   boombapbot-render --synth 7 --raw cymbal.f32 [--rate 48000]
//       [--tune 0.5] [--tone 0.5] [--decay 0.5] [--snappy 0.5]

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <string>
#include <vector>

#include "project_io.h"

namespace {

int writeSound(std::map<std::string, std::string>& options) {
  const auto knob = [&options](const char* name) {
    return options.count(name) ? static_cast<float>(std::atof(options[name].c_str())) : 0.5f;
  };
  const double rate = options.count("--rate") ? std::atof(options["--rate"].c_str()) : 44100.0;
  const SnareSoundParams params{std::atoi(options["--synth"].c_str()), knob("--tune"), knob("--tone"),
                                knob("--decay"), knob("--snappy"), 0};
  const int frames = snare_synth_frames(&params, rate);
  if (frames <= 0) {
    std::fprintf(stderr, "boombapbot-render: sound %d cannot be synthesised at %.0f Hz\n", params.sound, rate);
    return 1;
  }
  std::vector<float> pcm(static_cast<std::size_t>(frames));
  snare_synth_render(&params, rate, pcm.data(), frames);
  std::ofstream out(options["--raw"], std::ios::binary);
  out.write(reinterpret_cast<const char*>(pcm.data()),
            static_cast<std::streamsize>(pcm.size() * sizeof(float)));
  return out ? 0 : 1;
}

int effectNamed(const std::string& name) {
  if (name == "delay") return SNARE_EFFECT_DELAY;
  if (name == "reverb") return SNARE_EFFECT_REVERB;
  if (name == "flanger") return SNARE_EFFECT_FLANGER;
  if (name == "chorus") return SNARE_EFFECT_CHORUS;
  throw std::runtime_error("no such effect: " + name);
}

}  // namespace

int main(int argc, char** argv) {
  std::map<std::string, std::string> options;
  for (int i = 1; i + 1 < argc; i += 2) options[argv[i]] = argv[i + 1];
  if (options.count("--synth") && options.count("--raw")) return writeSound(options);
  if (!options.count("--project") || !options.count("--machine")) {
    std::fprintf(stderr,
                 "usage: boombapbot-render --project FILE --machine DIR [--rhythm N] [--version a|b]\n"
                 "         [--rate HZ] [--bits 16|24] [--out FILE.wav] [--midi FILE.mid]\n"
                 "         [--events FILE.json] [--swing 0..128]\n"
                 "         [--effect delay|reverb|flanger|chorus] [--wet 0..1]\n");
    return 2;
  }

  try {
    const std::string machineDir = options["--machine"];
    const double rate = options.count("--rate") ? std::atof(options["--rate"].c_str()) : 44100.0;
    const int bits = options.count("--bits") ? std::atoi(options["--bits"].c_str()) : 24;
    const int rhythm = options.count("--rhythm") ? std::atoi(options["--rhythm"].c_str()) : 0;
    const int version = options.count("--version") && options["--version"] == "b" ? 1 : 0;
    if (rhythm < 0 || rhythm * 2 >= SNARE_PATTERNS) throw std::runtime_error("no such rhythm");
    const int index = rhythm * 2 + version;

    const snare::io::Roles roles = snare::io::loadRoles(machineDir);
    const snare::io::Machine machine = snare::io::loadMachine(machineDir, roles);
    const snare::io::Project project = snare::io::loadProject(options["--project"], machine);

    SnareEngine* engine = snare_engine_create(rate);
    if (!engine) throw std::runtime_error("unsupported sample rate");
    snare_engine_enable_event_log(engine, 8192);
    snare::io::applyProject(engine, machine, project);
    // Swing and an effect are not the 808's; they are here so the engine's
    // own features can be rendered and compared from the command line.
    SnarePattern pattern = project.patterns[index];
    if (options.count("--swing")) {
      pattern.swing = static_cast<std::uint8_t>(std::atoi(options["--swing"].c_str()));
      if (snare_engine_set_pattern(engine, index, &pattern) != SNARE_OK) throw std::runtime_error("no such swing");
    }
    if (options.count("--effect")) {
      const double wet = options.count("--wet") ? std::atof(options["--wet"].c_str()) : 1.0;
      if (snare_engine_set_effect(engine, effectNamed(options["--effect"]), wet) != SNARE_OK) {
        throw std::runtime_error("no such effect setting");
      }
    }
    const snare::io::Rendered loop = snare::io::renderLoop(engine, pattern, index, project.bpm, rate);

    if (options.count("--out")) {
      snare::wav::writeFile(options["--out"],
                            snare::wav::encodeStereo(loop.left, loop.right, rate, bits));
    }

    if (options.count("--events")) {
      std::vector<SnareEvent> events(static_cast<std::size_t>(snare_engine_event_count(engine)));
      if (!events.empty()) {
        snare_engine_read_events(engine, events.data(), static_cast<int>(events.size()));
      }
      std::ofstream out(options["--events"]);
      out << "[";
      for (std::size_t i = 0; i < events.size(); ++i) {
        out << (i ? "," : "") << "\n  {\"frame\": " << static_cast<long long>(events[i].frame)
            << ", \"step\": " << events[i].step << ", \"track\": " << events[i].track
            << ", \"accent\": " << events[i].accent << ", \"pattern\": " << events[i].pattern << "}";
      }
      out << "\n]\n";
    }

    if (options.count("--midi")) {
      // The note of the sound each track is switched to.
      std::uint8_t notes[SNARE_TRACKS]{};
      for (int track = 1; track < SNARE_TRACKS; ++track) {
        notes[track] = roles.gmNotes[static_cast<std::size_t>(snare::io::trackSlot(machine, project, track))];
      }
      const std::uint8_t sequence[1] = {static_cast<std::uint8_t>(index)};
      const int plain = snare::io::midiVelocity(snare::io::kPlainHit);
      const int accented = snare::io::midiVelocity(snare::io::accentedHit(project.accent));
      const int size = snare_midi_export(project.patterns, SNARE_PATTERNS, sequence, 1, notes, plain, accented,
                                         project.bpm, nullptr, 0);
      std::vector<std::uint8_t> midi(static_cast<std::size_t>(size));
      snare_midi_export(project.patterns, SNARE_PATTERNS, sequence, 1, notes, plain, accented, project.bpm,
                        midi.data(), size);
      snare::wav::writeFile(options["--midi"], midi);
    }

    std::printf("%s: rhythm %d%s, %.2f bpm, %zu frames at %.0f Hz\n", project.name.c_str(), rhythm + 1,
                version ? "B" : "A", project.bpm, loop.left.size(), rate);
    snare_engine_destroy(engine);
  } catch (const std::exception& error) {
    std::fprintf(stderr, "boombapbot-render: %s\n", error.what());
    return 1;
  }
  return 0;
}
