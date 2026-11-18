// The 606's voices: there are seven; each is deterministic, finite, bounded,
// audible, as long as it says it is and silent at its end, at every sample
// rate; no two are alike; the engine's knobs change none of them, because
// the machine has none; and they keep the character the panel promises.

#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#include "boombapbot/voices.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr int kVoices = 7;
const double kRates[] = {44100.0, 48000.0, 96000.0};
const char* const kNames[kVoices] = {"bass drum", "snare drum", "low tom", "hi tom",
                                     "cymbal",    "open hat",   "closed hat"};
enum { kKick = 0, kSnare, kLowTom, kHighTom, kCymbal, kOpenHat, kClosedHat };

SnareSoundParams params(int sound, float tune = 0.5f, float tone = 0.5f, float decay = 0.5f, float snappy = 0.5f) {
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

// How often the signal changes sign per second: a cheap stand-in for pitch and brightness.
double crossingsPerSecond(const std::vector<float>& pcm, double rate, double seconds) {
  const auto count = static_cast<std::size_t>(seconds * rate);
  int crossings = 0;
  for (std::size_t i = 1; i < count && i < pcm.size(); ++i) {
    if ((pcm[i - 1] < 0.0f) != (pcm[i] < 0.0f)) ++crossings;
  }
  return crossings / seconds;
}

bool same(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

double secondsOf(int sound) {
  const SnareSoundParams settings = params(sound);
  return snare_synth_frames(&settings, 48000.0) / 48000.0;
}

}  // namespace

SNARE_TEST(the_machine_has_seven_voices_and_no_more) {
  CHECK_EQ(boombapbot::machineVoices().count, kVoices);
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams settings = params(sound);
    CHECK(snare_synth_frames(&settings, 48000.0) > 0);
  }
  const SnareSoundParams eighth = params(kVoices);
  CHECK_EQ(snare_synth_frames(&eighth, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  float sample = 0.0f;
  CHECK_EQ(snare_synth_render(&eighth, 48000.0, &sample, 1), SNARE_ERR_BAD_ARGUMENT);
}

SNARE_TEST(every_voice_is_finite_bounded_audible_and_ends_in_silence) {
  for (int sound = 0; sound < kVoices; ++sound) {
    for (double rate : kRates) {
      const std::vector<float> pcm = render(params(sound), rate);
      bool finite = true;
      for (float sample : pcm) finite = finite && std::isfinite(sample);
      const double loudest = peak(pcm);
      if (!finite || loudest > 1.0 || loudest < 0.2 || pcm.back() != 0.0f) {
        std::printf("  %s at %g Hz: finite %d, peak %g, last %g\n", kNames[sound], rate, finite, loudest,
                    static_cast<double>(pcm.back()));
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

SNARE_TEST(a_voice_is_as_long_as_it_says_at_every_sample_rate) {
  const boombapbot::VoiceTable& table = boombapbot::machineVoices();
  const boombapbot::Knobs knobs{0.5, 0.5, 0.5, 0.5};
  for (int sound = 0; sound < kVoices; ++sound) {
    const double seconds = table.voices[sound].seconds(knobs);
    for (double rate : kRates) {
      const SnareSoundParams settings = params(sound);
      CHECK_EQ(snare_synth_frames(&settings, rate), static_cast<int>(seconds * rate));
      CHECK_EQ(static_cast<int>(render(settings, rate).size()), static_cast<int>(seconds * rate));
    }
  }
}

SNARE_TEST(the_same_settings_render_the_same_samples) {
  for (int sound = 0; sound < kVoices; ++sound) {
    CHECK(same(render(params(sound), 48000.0), render(params(sound), 48000.0)));
  }
}

SNARE_TEST(no_two_voices_are_alike) {
  for (int a = 0; a < kVoices; ++a) {
    for (int b = a + 1; b < kVoices; ++b) {
      const bool alike = same(render(params(a), 48000.0), render(params(b), 48000.0));
      if (alike) std::printf("  %s and %s are the same sound\n", kNames[a], kNames[b]);
      CHECK(!alike);
    }
  }
}

SNARE_TEST(the_machine_has_no_sound_knobs_so_the_engines_change_nothing) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const std::vector<float> resting = render(params(sound), 48000.0);
    CHECK(same(resting, render(params(sound, 0.0f, 0.0f, 0.0f, 0.0f), 48000.0)));
    CHECK(same(resting, render(params(sound, 1.0f, 1.0f, 1.0f, 1.0f), 48000.0)));
    const SnareSoundParams turned = params(sound, 1.0f, 0.0f, 1.0f, 0.0f);
    CHECK_EQ(snare_synth_frames(&turned, 48000.0), static_cast<int>(resting.size()));
  }
}

SNARE_TEST(the_drums_are_pitched_low_to_high_and_the_metal_is_bright) {
  double pitch[kVoices];
  for (int sound = 0; sound < kVoices; ++sound) {
    // Past the attack, where a drum has settled on its pitch.
    const std::vector<float> pcm = render(params(sound), 48000.0);
    const std::vector<float> settled(pcm.begin() + 1440, pcm.end());
    pitch[sound] = crossingsPerSecond(settled, 48000.0, sound == kClosedHat ? 0.03 : 0.1);
  }
  CHECK(pitch[kKick] < pitch[kLowTom]);
  CHECK(pitch[kLowTom] * 1.3 < pitch[kHighTom]);
  CHECK(pitch[kHighTom] < pitch[kSnare]);
  for (int metal : {kCymbal, kOpenHat, kClosedHat}) {
    if (pitch[metal] <= 8000.0) std::printf("  %s: %g crossings a second\n", kNames[metal], pitch[metal]);
    CHECK(pitch[metal] > 8000.0);
  }
}

SNARE_TEST(the_voices_are_short_and_the_closed_hat_is_the_shortest) {
  CHECK(secondsOf(kClosedHat) < 0.2);
  CHECK(secondsOf(kClosedHat) * 4.0 < secondsOf(kOpenHat));
  CHECK(secondsOf(kOpenHat) * 2.0 < secondsOf(kCymbal));
  CHECK(secondsOf(kCymbal) < 2.5);
  for (int drum : {kKick, kSnare, kLowTom, kHighTom}) CHECK(secondsOf(drum) < 0.8);
  // The two hats are the same metal: alike at the strike, apart once the closed one has shut.
  const std::vector<float> open = render(params(kOpenHat), 48000.0);
  const std::vector<float> closed = render(params(kClosedHat), 48000.0);
  CHECK_NEAR(rms(open, 0, 96), rms(closed, 0, 96), 0.1);
  CHECK(rms(open, 2400, 2880) > rms(closed, 2400, 2880) * 4.0);
}

SNARE_TEST_MAIN()
