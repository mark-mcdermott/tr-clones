// The synthesised sounds: every one is deterministic, finite, bounded, audible
// and ends in silence, at every sample rate and across its knobs' travel. The
// knobs do what their names say.

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "test_util.h"

using namespace snare::test;

namespace {

const double kRates[] = {44100.0, 48000.0, 96000.0};
const float kTravel[] = {0.0f, 0.5f, 1.0f};
const char* const kNames[SNARE_SOUNDS] = {
    "kick",      "snare",   "closed hat", "open hat",  "low tom",   "high tom",
    "clap",      "cymbal",  "mid tom",    "rim shot",  "cowbell",   "low conga",
    "mid conga", "hi conga", "claves",    "maracas"};

SnareSoundParams params(int sound, float tune = 0.5f, float tone = 0.5f, float decay = 0.5f,
                        float snappy = 0.5f) {
  return SnareSoundParams{sound, tune, tone, decay, snappy, 0};
}

std::vector<float> render(const SnareSoundParams& sound, double rate) {
  const int frames = snare_synth_frames(&sound, rate);
  CHECK(frames > 0);
  std::vector<float> out(static_cast<std::size_t>(frames > 0 ? frames : 0));
  CHECK_EQ(snare_synth_render(&sound, rate, out.data(), frames), frames);
  return out;
}

double peak(const std::vector<float>& pcm) {
  double value = 0.0;
  for (float sample : pcm) value = std::fmax(value, std::fabs(static_cast<double>(sample)));
  return value;
}

double rms(const std::vector<float>& pcm, std::size_t from, std::size_t to) {
  double sum = 0.0;
  for (std::size_t i = from; i < to && i < pcm.size(); ++i) sum += static_cast<double>(pcm[i]) * pcm[i];
  return std::sqrt(sum / static_cast<double>(to - from));
}

// Energy of the sample-to-sample change against the energy of the signal:
// higher when more of the sound sits in the treble.
double brightness(const std::vector<float>& pcm, std::size_t count) {
  double change = 0.0, level = 0.0;
  for (std::size_t i = 1; i < count && i < pcm.size(); ++i) {
    const double step = static_cast<double>(pcm[i]) - pcm[i - 1];
    change += step * step;
    level += static_cast<double>(pcm[i]) * pcm[i];
  }
  return change / level;
}

// How often the signal changes sign per second: a cheap stand-in for pitch.
double crossingsPerSecond(const std::vector<float>& pcm, double rate, double seconds) {
  const auto count = static_cast<std::size_t>(seconds * rate);
  int crossings = 0;
  for (std::size_t i = 1; i < count && i < pcm.size(); ++i) {
    if ((pcm[i - 1] < 0.0f) != (pcm[i] < 0.0f)) ++crossings;
  }
  return crossings / seconds;
}

}  // namespace

SNARE_TEST(every_sound_is_finite_bounded_audible_and_ends_in_silence) {
  for (int sound = 0; sound < SNARE_SOUNDS; ++sound) {
    for (double rate : kRates) {
      for (float knob : kTravel) {
        const std::vector<float> pcm = render(params(sound, knob, knob, knob, knob), rate);
        bool finite = true;
        for (float sample : pcm) finite = finite && std::isfinite(sample);
        const double loudest = peak(pcm);
        if (!finite || loudest > 1.0 || loudest < 0.2 || pcm.back() != 0.0f) {
          std::printf("  %s at %g Hz, knobs %g: finite %d, peak %g, last %g\n", kNames[sound], rate,
                      static_cast<double>(knob), finite, loudest, static_cast<double>(pcm.back()));
        }
        CHECK(finite);
        CHECK(loudest <= 1.0);
        CHECK(loudest >= 0.2);
        CHECK_EQ(pcm.back(), 0.0f);
        // Nothing left but the last few milliseconds of the tail.
        const auto tail = static_cast<std::size_t>(0.004 * rate);
        CHECK(rms(pcm, pcm.size() - tail, pcm.size()) < 0.02);
      }
    }
  }
}

SNARE_TEST(the_same_settings_render_the_same_samples) {
  for (int sound = 0; sound < SNARE_SOUNDS; ++sound) {
    const SnareSoundParams settings = params(sound, 0.3f, 0.7f, 0.6f, 0.4f);
    const std::vector<float> first = render(settings, 48000.0);
    const std::vector<float> second = render(settings, 48000.0);
    CHECK_EQ(first.size(), second.size());
    CHECK(std::memcmp(first.data(), second.data(), first.size() * sizeof(float)) == 0);
  }
}

SNARE_TEST(a_sound_lasts_the_same_time_at_every_sample_rate) {
  for (int sound = 0; sound < SNARE_SOUNDS; ++sound) {
    const SnareSoundParams settings = params(sound);
    const double seconds = snare_synth_frames(&settings, 48000.0) / 48000.0;
    for (double rate : kRates) {
      CHECK_NEAR(snare_synth_frames(&settings, rate) / rate, seconds, 2.0 / rate);
    }
  }
}

SNARE_TEST(decay_knobs_lengthen_the_sound) {
  struct Case {
    int sound;
    double from;  // seconds: by here the short setting has all but gone
    double to;
  };
  for (const Case& test : {Case{SNARE_SOUND_KICK, 0.15, 0.25}, Case{SNARE_SOUND_OPEN_HAT, 0.15, 0.25},
                           Case{SNARE_SOUND_CYMBAL, 1.0, 1.2}}) {
    const SnareSoundParams shortSettings = params(test.sound, 0.5f, 0.5f, 0.0f);
    const SnareSoundParams longSettings = params(test.sound, 0.5f, 0.5f, 1.0f);
    CHECK(snare_synth_frames(&longSettings, 48000.0) > 2 * snare_synth_frames(&shortSettings, 48000.0));
    const std::vector<float> shortPcm = render(shortSettings, 48000.0);
    const std::vector<float> longPcm = render(longSettings, 48000.0);
    const auto from = static_cast<std::size_t>(test.from * 48000.0);
    const auto to = static_cast<std::size_t>(test.to * 48000.0);
    CHECK(rms(longPcm, from, to) > 4.0 * rms(shortPcm, from, to) + 1e-4);
  }
}

SNARE_TEST(tuning_knobs_raise_the_pitch) {
  for (int sound : {SNARE_SOUND_LOW_TOM, SNARE_SOUND_MID_TOM, SNARE_SOUND_HIGH_TOM,
                    SNARE_SOUND_LOW_CONGA, SNARE_SOUND_MID_CONGA, SNARE_SOUND_HIGH_CONGA}) {
    const double low = crossingsPerSecond(render(params(sound, 0.0f), 48000.0), 48000.0, 0.1);
    const double high = crossingsPerSecond(render(params(sound, 1.0f), 48000.0), 48000.0, 0.1);
    CHECK(high > low * 1.25);
  }
  // The three toms, and the three congas, sit in order from low to high.
  const auto pitch = [](int sound) {
    return crossingsPerSecond(render(params(sound), 48000.0), 48000.0, 0.1);
  };
  CHECK(pitch(SNARE_SOUND_LOW_TOM) < pitch(SNARE_SOUND_MID_TOM));
  CHECK(pitch(SNARE_SOUND_MID_TOM) < pitch(SNARE_SOUND_HIGH_TOM));
  CHECK(pitch(SNARE_SOUND_LOW_CONGA) < pitch(SNARE_SOUND_MID_CONGA));
  CHECK(pitch(SNARE_SOUND_MID_CONGA) < pitch(SNARE_SOUND_HIGH_CONGA));
  CHECK(pitch(SNARE_SOUND_LOW_TOM) < pitch(SNARE_SOUND_LOW_CONGA));
}

SNARE_TEST(tone_and_snappy_brighten_the_sound) {
  const auto bright = [](const SnareSoundParams& settings) {
    return brightness(render(settings, 48000.0), 4800);
  };
  CHECK(bright(params(SNARE_SOUND_SNARE, 0.5f, 0.5f, 0.5f, 1.0f)) >
        1.5 * bright(params(SNARE_SOUND_SNARE, 0.5f, 0.5f, 0.5f, 0.0f)));
  CHECK(bright(params(SNARE_SOUND_SNARE, 0.5f, 1.0f, 0.5f, 0.0f)) >
        bright(params(SNARE_SOUND_SNARE, 0.5f, 0.0f, 0.5f, 0.0f)));
  CHECK(bright(params(SNARE_SOUND_CYMBAL, 0.5f, 1.0f)) >
        1.15 * bright(params(SNARE_SOUND_CYMBAL, 0.5f, 0.0f)));
  // The kick's tone opens up its click; its body stays where it is.
  const std::vector<float> dullKick = render(params(SNARE_SOUND_KICK, 0.5f, 0.0f), 48000.0);
  const std::vector<float> brightKick = render(params(SNARE_SOUND_KICK, 0.5f, 1.0f), 48000.0);
  CHECK(brightness(brightKick, 96) > 1.5 * brightness(dullKick, 96));
}

SNARE_TEST(a_knob_a_sound_does_not_have_changes_nothing) {
  // The closed hat has no knobs at all; the claves ignore tone and decay.
  for (int sound : {SNARE_SOUND_CLOSED_HAT, SNARE_SOUND_CLAVES, SNARE_SOUND_COWBELL, SNARE_SOUND_RIM_SHOT}) {
    const std::vector<float> plain = render(params(sound, 0.0f, 0.0f, 0.0f, 0.0f), 48000.0);
    const std::vector<float> turned = render(params(sound, 1.0f, 1.0f, 1.0f, 1.0f), 48000.0);
    CHECK_EQ(plain.size(), turned.size());
    CHECK(std::memcmp(plain.data(), turned.data(), plain.size() * sizeof(float)) == 0);
  }
}

SNARE_TEST(out_of_range_knobs_are_clamped_and_bad_arguments_refused) {
  const std::vector<float> full = render(params(SNARE_SOUND_KICK, 1.0f, 1.0f, 1.0f, 1.0f), 48000.0);
  const std::vector<float> over = render(params(SNARE_SOUND_KICK, 9.0f, 9.0f, 9.0f, 9.0f), 48000.0);
  CHECK_EQ(full.size(), over.size());
  CHECK(std::memcmp(full.data(), over.data(), full.size() * sizeof(float)) == 0);

  const SnareSoundParams kick = params(SNARE_SOUND_KICK);
  const SnareSoundParams unknown = params(SNARE_SOUNDS);
  const SnareSoundParams negative = params(-1);
  std::vector<float> out(16);
  CHECK_EQ(snare_synth_frames(nullptr, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_frames(&unknown, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_frames(&negative, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_frames(&kick, 100.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_render(&kick, 48000.0, nullptr, 1 << 20), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_render(&kick, 48000.0, out.data(), 16), SNARE_ERR_TOO_LARGE);
}

int main(int argc, char** argv) {
  // "levels" prints each sound's peak and loudness, for balancing by hand.
  if (argc > 1 && std::strcmp(argv[1], "levels") == 0) {
    for (int sound = 0; sound < SNARE_SOUNDS; ++sound) {
      const SnareSoundParams settings = params(sound);
      const std::vector<float> pcm = render(settings, 48000.0);
      std::printf("%-11s %5.2f s  peak %.3f  rms(first 50 ms) %.3f\n", kNames[sound],
                  static_cast<double>(pcm.size()) / 48000.0, peak(pcm), rms(pcm, 0, 2400));
    }
    return 0;
  }
  return ::snare::test::runAll();
}
