// The 909's voices: there are eleven; each is deterministic, finite, bounded,
// audible and ends in silence at every sample rate and across its knobs'
// travel; no two are the same sound; and each answers the knobs its panel
// column has, and no others.

#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#include "test_util.h"

using namespace snare::test;

namespace {

enum Knob { kTune, kTone, kDecay, kSnappy, kKnobCount };

struct VoiceCase {
  const char* name;
  // The knobs of its panel column. The bass drum's ATTACK is the engine's tone.
  bool has[kKnobCount];
};

constexpr int kVoices = 11;
const VoiceCase kCases[kVoices] = {
    {"bass drum", {true, true, true, false}},
    {"snare drum", {true, true, false, true}},
    {"low tom", {true, false, true, false}},
    {"mid tom", {true, false, true, false}},
    {"hi tom", {true, false, true, false}},
    {"rim shot", {false, false, false, false}},
    {"hand clap", {false, false, false, false}},
    {"closed hi-hat", {false, false, true, false}},
    {"open hi-hat", {false, false, true, false}},
    {"crash", {true, false, false, false}},
    {"ride", {true, false, false, false}},
};
const char* const kKnobNames[kKnobCount] = {"tune", "tone", "decay", "snappy"};
const double kRates[] = {44100.0, 48000.0, 96000.0};
const float kTravel[] = {0.0f, 0.5f, 1.0f};
// The drums whose pitch a count of zero crossings can follow.
const int kDrums[] = {0, 2, 3, 4};
const int kCymbals[] = {9, 10};

SnareSoundParams params(int sound, float tune = 0.5f, float tone = 0.5f, float decay = 0.5f, float snappy = 0.5f) {
  return SnareSoundParams{sound, tune, tone, decay, snappy, 0};
}

// The settings of a voice with one knob moved and the rest at rest.
SnareSoundParams withKnob(int sound, int knob, float value) {
  float knobs[kKnobCount] = {0.5f, 0.5f, 0.5f, 0.5f};
  knobs[knob] = value;
  return params(sound, knobs[kTune], knobs[kTone], knobs[kDecay], knobs[kSnappy]);
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

// How much the signal moves from one sample to the next: large for a click, small for a sine.
double roughness(const std::vector<float>& pcm, std::size_t count) {
  double sum = 0.0;
  for (std::size_t i = 1; i < count && i < pcm.size(); ++i) sum += std::fabs(static_cast<double>(pcm[i]) - pcm[i - 1]);
  return sum;
}

bool same(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

}  // namespace

SNARE_TEST(the_machine_has_eleven_voices_and_no_more) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams settings = params(sound);
    CHECK(snare_synth_frames(&settings, 48000.0) > 0);
  }
  const SnareSoundParams twelfth = params(kVoices);
  CHECK_EQ(snare_synth_frames(&twelfth, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  float sample = 0.0f;
  CHECK_EQ(snare_synth_render(&twelfth, 48000.0, &sample, 1), SNARE_ERR_BAD_ARGUMENT);
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
          std::printf("  %s at %g Hz, knobs %g: finite %d, peak %g, last %g\n", kCases[sound].name, rate,
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

SNARE_TEST(a_voice_lasts_the_same_time_at_every_sample_rate) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams settings = params(sound);
    const double seconds = snare_synth_frames(&settings, 48000.0) / 48000.0;
    for (double rate : kRates) CHECK_NEAR(snare_synth_frames(&settings, rate) / rate, seconds, 2.0 / rate);
  }
  // The two voices with no knobs have one length each.
  const SnareSoundParams rim = params(5);
  const SnareSoundParams clap = params(6);
  CHECK_NEAR(snare_synth_frames(&rim, 48000.0) / 48000.0, 0.11, 1e-4);
  CHECK_NEAR(snare_synth_frames(&clap, 48000.0) / 48000.0, 0.75, 1e-4);
}

SNARE_TEST(no_two_voices_are_the_same_sound) {
  std::vector<std::vector<float>> sounds;
  for (int sound = 0; sound < kVoices; ++sound) sounds.push_back(render(params(sound), 48000.0));
  for (int a = 0; a < kVoices; ++a) {
    for (int b = a + 1; b < kVoices; ++b) {
      if (same(sounds[static_cast<std::size_t>(a)], sounds[static_cast<std::size_t>(b)])) {
        std::printf("  %s and %s are the same\n", kCases[a].name, kCases[b].name);
      }
      CHECK(!same(sounds[static_cast<std::size_t>(a)], sounds[static_cast<std::size_t>(b)]));
    }
  }
}

SNARE_TEST(a_voice_answers_the_knobs_of_its_column_and_no_others) {
  for (int sound = 0; sound < kVoices; ++sound) {
    for (int knob = 0; knob < kKnobCount; ++knob) {
      const bool moved = !same(render(withKnob(sound, knob, 0.1f), 48000.0), render(withKnob(sound, knob, 0.9f), 48000.0));
      if (moved != kCases[sound].has[knob]) {
        std::printf("  %s %s the %s knob\n", kCases[sound].name, moved ? "answers" : "ignores", kKnobNames[knob]);
      }
      CHECK_EQ(moved, kCases[sound].has[knob]);
    }
  }
}

SNARE_TEST(the_decay_knob_lengthens_the_voices_that_have_one) {
  for (int sound = 0; sound < kVoices; ++sound) {
    if (!kCases[sound].has[kDecay]) continue;
    const SnareSoundParams tight = withKnob(sound, kDecay, 0.0f);
    const SnareSoundParams loose = withKnob(sound, kDecay, 1.0f);
    const int shortFrames = snare_synth_frames(&tight, 48000.0);
    const int longFrames = snare_synth_frames(&loose, 48000.0);
    if (longFrames <= shortFrames * 2) std::printf("  %s: %d then %d frames\n", kCases[sound].name, shortFrames, longFrames);
    CHECK(longFrames > shortFrames * 2);
    // More of the sound is left a little way in.
    const std::vector<float> a = render(tight, 48000.0);
    const std::vector<float> b = render(loose, 48000.0);
    const auto from = static_cast<std::size_t>(shortFrames / 2);
    CHECK(rms(b, from, from + 480) > rms(a, from, from + 480));
  }
}

SNARE_TEST(the_closed_hat_is_the_short_one) {
  for (float knob : kTravel) {
    const SnareSoundParams closed = withKnob(7, kDecay, knob);
    const SnareSoundParams open = withKnob(8, kDecay, knob);
    CHECK(snare_synth_frames(&open, 48000.0) > snare_synth_frames(&closed, 48000.0) * 3);
  }
}

SNARE_TEST(the_tune_knob_raises_the_drums) {
  for (int sound : kDrums) {
    const std::vector<float> low = render(params(sound, 0.0f, 0.0f, 1.0f), 48000.0);
    const std::vector<float> high = render(params(sound, 1.0f, 0.0f, 1.0f), 48000.0);
    const double below = crossingsPerSecond(low, 48000.0, 0.15);
    const double above = crossingsPerSecond(high, 48000.0, 0.15);
    if (above <= below * 1.25) std::printf("  %s: %g then %g crossings a second\n", kCases[sound].name, below, above);
    CHECK(above > below * 1.25);
  }
}

SNARE_TEST(the_tune_knob_plays_a_cymbal_faster_so_higher_and_shorter) {
  for (int sound : kCymbals) {
    const SnareSoundParams slow = withKnob(sound, kTune, 0.0f);
    const SnareSoundParams fast = withKnob(sound, kTune, 1.0f);
    CHECK(snare_synth_frames(&slow, 48000.0) > snare_synth_frames(&fast, 48000.0) * 1.4);
    const double below = crossingsPerSecond(render(slow, 48000.0), 48000.0, 0.2);
    const double above = crossingsPerSecond(render(fast, 48000.0), 48000.0, 0.2);
    if (above <= below * 1.15) std::printf("  %s: %g then %g crossings a second\n", kCases[sound].name, below, above);
    CHECK(above > below * 1.15);
  }
}

SNARE_TEST(attack_puts_a_click_on_the_bass_drum) {
  const std::vector<float> soft = render(withKnob(0, kTone, 0.0f), 48000.0);
  const std::vector<float> hard = render(withKnob(0, kTone, 1.0f), 48000.0);
  CHECK_EQ(soft.size(), hard.size());
  // The first three milliseconds are where the click is.
  CHECK(roughness(hard, 144) > roughness(soft, 144) * 3.0);
  // Once it has gone, the drum under it is the same drum.
  CHECK_NEAR(rms(hard, 4800, 9600), rms(soft, 4800, 9600), 0.01);
}

SNARE_TEST(snappy_and_tone_shape_the_snare_noise) {
  const std::vector<float> dry = render(withKnob(1, kSnappy, 0.0f), 48000.0);
  const std::vector<float> snappy = render(withKnob(1, kSnappy, 1.0f), 48000.0);
  CHECK(crossingsPerSecond(snappy, 48000.0, 0.1) > crossingsPerSecond(dry, 48000.0, 0.1) * 2.0);
  const SnareSoundParams dull = withKnob(1, kTone, 0.0f);
  const SnareSoundParams bright = withKnob(1, kTone, 1.0f);
  CHECK(snare_synth_frames(&bright, 48000.0) > snare_synth_frames(&dull, 48000.0) * 2);
  CHECK(crossingsPerSecond(render(bright, 48000.0), 48000.0, 0.1) > crossingsPerSecond(render(dull, 48000.0), 48000.0, 0.1));
}

SNARE_TEST(the_hats_and_cymbals_are_brighter_than_the_drums) {
  const double snare = crossingsPerSecond(render(params(1), 48000.0), 48000.0, 0.05);
  for (int sound : {7, 8, 9, 10}) {
    const double metal = crossingsPerSecond(render(params(sound), 48000.0), 48000.0, 0.05);
    if (metal <= snare * 1.5) std::printf("  %s: %g against the snare's %g\n", kCases[sound].name, metal, snare);
    CHECK(metal > snare * 1.5);
    CHECK(metal > 9000.0);
  }
}

SNARE_TEST_MAIN()
