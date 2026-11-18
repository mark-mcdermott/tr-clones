// The 707's voices: there are fifteen; each is deterministic, finite,
// bounded, audible and ends in silence at every sample rate and across its
// knobs' travel; no two are the same; and the knobs do what their names say.

#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#include "test_util.h"

using namespace snare::test;

namespace {

constexpr int kVoices = 15;
const double kRates[] = {44100.0, 48000.0, 96000.0};
const float kTravel[] = {0.0f, 0.5f, 1.0f};
const char* const kNames[kVoices] = {
    "bass drum 1", "bass drum 2", "snare drum 1", "snare drum 2", "low tom",    "mid tom", "hi tom", "rim shot",
    "cowbell",     "hand clap",   "tambourine",   "closed hat",   "open hat",   "crash",   "ride"};
enum { kBassDrum1, kBassDrum2, kSnareDrum1, kSnareDrum2, kLowTom, kMidTom, kHiTom, kRimShot, kCowbell, kClosedHat = 11, kOpenHat };
// The voices with a pitch that a count of zero crossings can follow.
const int kPitched[] = {kBassDrum1, kBassDrum2, kLowTom, kMidTom, kHiTom, kRimShot, kCowbell};

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

// How often the signal changes sign per second: a cheap stand-in for pitch.
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

SNARE_TEST(the_machine_has_fifteen_voices_and_no_more) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams settings = params(sound);
    CHECK(snare_synth_frames(&settings, 48000.0) > 0);
  }
  const SnareSoundParams sixteenth = params(kVoices);
  CHECK_EQ(snare_synth_frames(&sixteenth, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  float sample = 0.0f;
  CHECK_EQ(snare_synth_render(&sixteenth, 48000.0, &sample, 1), SNARE_ERR_BAD_ARGUMENT);
}

SNARE_TEST(every_voice_is_finite_bounded_audible_and_ends_in_silence) {
  for (int sound = 0; sound < kVoices; ++sound) {
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
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams settings = params(sound, 0.3f, 0.7f, 0.6f, 0.4f);
    CHECK(same(render(settings, 48000.0), render(settings, 48000.0)));
  }
}

SNARE_TEST(no_two_voices_are_the_same) {
  std::vector<std::vector<float>> rendered;
  for (int sound = 0; sound < kVoices; ++sound) rendered.push_back(render(params(sound), 48000.0));
  for (int a = 0; a < kVoices; ++a) {
    for (int b = a + 1; b < kVoices; ++b) {
      if (same(rendered[static_cast<std::size_t>(a)], rendered[static_cast<std::size_t>(b)])) {
        std::printf("  %s is %s\n", kNames[a], kNames[b]);
      }
      CHECK(!same(rendered[static_cast<std::size_t>(a)], rendered[static_cast<std::size_t>(b)]));
    }
  }
}

SNARE_TEST(a_voice_lasts_the_same_time_at_every_sample_rate) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams settings = params(sound);
    const double seconds = secondsOf(sound);
    for (double rate : kRates) {
      const int frames = snare_synth_frames(&settings, rate);
      CHECK_NEAR(frames / rate, seconds, 2.0 / rate);
      // What is rendered is as long as what was promised.
      CHECK_EQ(static_cast<int>(render(settings, rate).size()), frames);
    }
  }
}

SNARE_TEST(the_voices_are_as_long_as_the_drums_they_stand_for) {
  // Tight and dry: nothing but the cymbals and the open hat lasts a second.
  for (int sound = 0; sound < kOpenHat; ++sound) CHECK(secondsOf(sound) < 1.0);
  CHECK(secondsOf(kOpenHat) > secondsOf(kClosedHat) * 4.0);
  CHECK(secondsOf(kBassDrum2) < secondsOf(kBassDrum1));
  CHECK(secondsOf(kSnareDrum2) < secondsOf(kSnareDrum1));
  CHECK(secondsOf(kHiTom) < secondsOf(kMidTom));
  CHECK(secondsOf(kMidTom) < secondsOf(kLowTom));
  CHECK(secondsOf(kRimShot) < 0.2);
}

SNARE_TEST(the_toms_rise_from_low_to_hi) {
  const double low = crossingsPerSecond(render(params(kLowTom, 0.5f, 0.0f), 48000.0), 48000.0, 0.15);
  const double mid = crossingsPerSecond(render(params(kMidTom, 0.5f, 0.0f), 48000.0), 48000.0, 0.15);
  const double hi = crossingsPerSecond(render(params(kHiTom, 0.5f, 0.0f), 48000.0), 48000.0, 0.15);
  CHECK(mid > low * 1.2);
  CHECK(hi > mid * 1.2);
}

SNARE_TEST(the_decay_knob_lengthens_every_voice) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams tight = params(sound, 0.5f, 0.5f, 0.0f);
    const SnareSoundParams loose = params(sound, 0.5f, 0.5f, 1.0f);
    const int shortFrames = snare_synth_frames(&tight, 48000.0);
    const int longFrames = snare_synth_frames(&loose, 48000.0);
    if (longFrames <= shortFrames * 2) std::printf("  %s: %d then %d frames\n", kNames[sound], shortFrames, longFrames);
    CHECK(longFrames > shortFrames * 2);
    // More of the sound is left a little way in.
    const std::vector<float> a = render(tight, 48000.0);
    const std::vector<float> b = render(loose, 48000.0);
    const auto from = static_cast<std::size_t>(shortFrames / 2);
    CHECK(rms(b, from, from + 480) > rms(a, from, from + 480));
  }
}

SNARE_TEST(the_tune_knob_raises_the_pitch) {
  for (int sound : kPitched) {
    const std::vector<float> low = render(params(sound, 0.0f, 0.0f, 1.0f), 48000.0);
    const std::vector<float> high = render(params(sound, 1.0f, 0.0f, 1.0f), 48000.0);
    const double seconds = sound == kRimShot ? 0.03 : 0.15;
    const double below = crossingsPerSecond(low, 48000.0, seconds);
    const double above = crossingsPerSecond(high, 48000.0, seconds);
    if (above <= below * 1.2) std::printf("  %s: %g then %g crossings a second\n", kNames[sound], below, above);
    CHECK(above > below * 1.2);
  }
  // Every voice answers its tune knob, whether or not crossings can follow it.
  for (int sound = 0; sound < kVoices; ++sound) {
    CHECK(!same(render(params(sound, 0.2f), 48000.0), render(params(sound, 0.8f), 48000.0)));
  }
}

SNARE_TEST(the_tone_knob_changes_every_voice) {
  for (int sound = 0; sound < kVoices; ++sound) {
    CHECK(!same(render(params(sound, 0.5f, 0.1f), 48000.0), render(params(sound, 0.5f, 0.9f), 48000.0)));
  }
}

SNARE_TEST(the_snappy_knob_is_the_wires_of_the_snare_drums_and_nothing_else) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const std::vector<float> slack = render(params(sound, 0.5f, 0.5f, 0.5f, 0.0f), 48000.0);
    const std::vector<float> taut = render(params(sound, 0.5f, 0.5f, 0.5f, 1.0f), 48000.0);
    if (sound == kSnareDrum1 || sound == kSnareDrum2) {
      // Once the shell has died away, what is left is wires.
      const auto from = static_cast<std::size_t>(0.1 * 48000.0);
      CHECK(rms(taut, from, from + 2400) > rms(slack, from, from + 2400) * 2.0);
    } else {
      CHECK(same(slack, taut));
    }
  }
}

SNARE_TEST_MAIN()
