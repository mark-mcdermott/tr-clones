// The 808's voices, built from their knob settings.
//
// This is a model made by ear from general descriptions of analogue drum
// circuits: decaying tuned oscillators, filtered noise and a bank of six
// square waves for the metallic voices. It has not been compared with a real
// machine.
//
// Rules that keep native and WebAssembly renders in agreement:
//   - all arithmetic is double, cast to float once per sample at the end;
//   - the C library's sin, cos, tan and exp are used only to work out
//     coefficients, never inside a per-sample loop;
//   - noise comes from the integer generator in dsp.h;
//   - a sound's length comes from plain arithmetic; the engine fades its tail.

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "boombapbot/dsp.h"
#include "boombapbot/engine.h"
#include "boombapbot/voices.h"

namespace {

using boombapbot::Knobs;
using boombapbot::Voice;

using namespace boombapbot::dsp;

// The six detuned squares shared by the cymbal, both hi-hats and the cowbell.
class MetalBank {
 public:
  explicit MetalBank(double rate)
      : squares_{Square(205.3, rate), Square(304.4, rate), Square(369.6, rate),
                 Square(522.7, rate), Square(540.0, rate), Square(800.0, rate)} {}
  double next() {
    double sum = 0.0;
    for (Square& square : squares_) sum += square.next();
    return sum / 6.0;
  }

 private:
  Square squares_[6];
};

// ---- Voices ----------------------------------------------------------------

double kickSeconds(const Knobs& knobs) { return 0.02 + 6.9 * sweep(0.045, 0.42, knobs.decay); }

void renderKick(const Knobs& knobs, double rate, std::uint32_t, float* out, int frames) {
  const double body = decayCoefficient(sweep(0.045, 0.42, knobs.decay), rate);
  const double drop = decayCoefficient(0.011, rate);
  const double clickDecay = decayCoefficient(0.0016, rate);
  Biquad clickFilter = Biquad::lowpass(lerp(700.0, 6500.0, knobs.tone), 0.7, rate);
  Biquad tone = Biquad::lowpass(lerp(1800.0, 9000.0, knobs.tone), 0.6, rate);
  const double clickLevel = lerp(0.18, 0.75, knobs.tone);
  double phase = 0.0, amplitude = 1.0, pitch = 95.0, click = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double tone1 = sine(phase) * amplitude;
    const double transient = clickFilter.process(click) * clickLevel;
    out[i] = static_cast<float>(0.92 * saturate(1.15 * tone.process(tone1 + transient)));
    phase += (49.0 + pitch) / rate;
    phase -= std::floor(phase);
    amplitude *= body;
    pitch *= drop;
    click *= clickDecay;
  }
}

double snareSeconds(const Knobs&) { return 0.55; }

void renderSnare(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  const double lowDecay = decayCoefficient(0.085, rate);
  const double highDecay = decayCoefficient(0.050, rate);
  const double bendDecay = decayCoefficient(0.008, rate);
  const double noiseDecay = decayCoefficient(0.075, rate);
  Biquad noiseHigh = Biquad::highpass(1800.0, 0.7, rate);
  Biquad noiseLow = Biquad::lowpass(9500.0, 0.7, rate);
  const double lowLevel = lerp(0.95, 0.5, knobs.tone);
  const double highLevel = lerp(0.3, 0.85, knobs.tone);
  const double noiseLevel = lerp(0.08, 0.95, knobs.snappy);
  double lowPhase = 0.0, highPhase = 0.0, low = 1.0, high = 1.0, bend = 0.35, hiss = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double shell = sine(lowPhase) * low * lowLevel + sine(highPhase) * high * highLevel;
    const double snares = noiseLow.process(noiseHigh.process(noise.next())) * hiss * noiseLevel;
    out[i] = static_cast<float>(0.85 * saturate(0.9 * shell + 0.8 * snares));
    lowPhase += 173.0 * (1.0 + bend) / rate;
    highPhase += 331.0 * (1.0 + bend) / rate;
    lowPhase -= std::floor(lowPhase);
    highPhase -= std::floor(highPhase);
    low *= lowDecay;
    high *= highDecay;
    bend *= bendDecay;
    hiss *= noiseDecay;
  }
}

struct Drum {
  double lowHz;       // tuning knob fully left
  double highHz;      // tuning knob fully right
  double seconds;     // time constant of the body
  double bend;        // how far above its pitch the drum starts
  double bendSeconds;
  double rattle;      // level of the noise under a tom; congas have none
};

constexpr Drum kLowTom{82.0, 122.0, 0.20, 0.55, 0.030, 0.07};
constexpr Drum kMidTom{118.0, 172.0, 0.165, 0.55, 0.026, 0.07};
constexpr Drum kHighTom{162.0, 238.0, 0.135, 0.55, 0.022, 0.07};
constexpr Drum kLowConga{165.0, 245.0, 0.115, 0.12, 0.010, 0.0};
constexpr Drum kMidConga{245.0, 360.0, 0.095, 0.12, 0.010, 0.0};
constexpr Drum kHighConga{360.0, 520.0, 0.078, 0.12, 0.010, 0.0};

double drumSeconds(const Drum& drum) { return 0.02 + 6.9 * drum.seconds; }

void renderDrum(const Drum& drum, const Knobs& knobs, double rate, std::uint32_t seed, float* out,
                int frames) {
  Noise noise(seed);
  const double hz = sweep(drum.lowHz, drum.highHz, knobs.tune);
  const double body = decayCoefficient(drum.seconds, rate);
  const double bendDecay = decayCoefficient(drum.bendSeconds, rate);
  const double rattleDecay = decayCoefficient(drum.seconds * 0.7, rate);
  Biquad rattleFilter = Biquad::lowpass(hz * 5.0, 0.7, rate);
  double phase = 0.0, amplitude = 1.0, bend = drum.bend, rattle = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double skin = sine(phase) * amplitude;
    const double under = rattleFilter.process(noise.next()) * rattle * drum.rattle;
    out[i] = static_cast<float>(0.88 * saturate(1.05 * skin + under));
    phase += hz * (1.0 + bend) / rate;
    phase -= std::floor(phase);
    amplitude *= body;
    bend *= bendDecay;
    rattle *= rattleDecay;
  }
}

double rimShotSeconds(const Knobs&) { return 0.09; }

void renderRimShot(const Knobs&, double rate, std::uint32_t, float* out, int frames) {
  const double highDecay = decayCoefficient(0.0055, rate);
  const double lowDecay = decayCoefficient(0.0095, rate);
  Biquad highpass = Biquad::highpass(320.0, 0.7, rate);
  double highPhase = 0.0, lowPhase = 0.0, high = 1.0, low = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double knock = sine(highPhase) * high * 0.9 + sine(lowPhase) * low * 0.7;
    out[i] = static_cast<float>(0.62 * highpass.process(saturate(2.4 * knock)));
    highPhase += 1667.0 / rate;
    lowPhase += 455.0 / rate;
    highPhase -= std::floor(highPhase);
    lowPhase -= std::floor(lowPhase);
    high *= highDecay;
    low *= lowDecay;
  }
}

double clavesSeconds(const Knobs&) { return 0.20; }

void renderClaves(const Knobs&, double rate, std::uint32_t, float* out, int frames) {
  const double ring = decayCoefficient(0.024, rate);
  double phase = 0.0, amplitude = 1.0;
  for (int i = 0; i < frames; ++i) {
    out[i] = static_cast<float>(0.8 * sine(phase) * amplitude);
    phase += 2500.0 / rate;
    phase -= std::floor(phase);
    amplitude *= ring;
  }
}

double clapSeconds(const Knobs&) { return 0.75; }

void renderClap(const Knobs&, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Biquad band = Biquad::bandpass(1050.0, 1.6, rate);
  Biquad highpass = Biquad::highpass(420.0, 0.7, rate);
  const double slapDecay = decayCoefficient(0.0045, rate);
  const double roomDecay = decayCoefficient(0.085, rate);
  // Three quick slaps, then the room.
  const int spacing = static_cast<int>(0.0105 * rate);
  const int roomStart = spacing * 3;
  double slap = 1.0, room = 0.0;
  for (int i = 0; i < frames; ++i) {
    if (i == spacing || i == spacing * 2) slap = 1.0;
    if (i == roomStart) room = 1.0;
    const double envelope = std::max(slap * (i < roomStart ? 1.0 : 0.0), room * 0.75);
    const double hands = highpass.process(band.process(noise.next()));
    out[i] = static_cast<float>(0.9 * saturate(3.2 * hands * envelope));
    slap *= slapDecay;
    room *= roomDecay;
  }
}

double maracasSeconds(const Knobs&) { return 0.14; }

void renderMaracas(const Knobs&, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Biquad highpass = Biquad::highpass(5200.0, 0.8, rate);
  const int attack = std::max(1, static_cast<int>(0.011 * rate));
  const double fall = decayCoefficient(0.017, rate);
  double tail = 1.0;
  for (int i = 0; i < frames; ++i) {
    // The beads gather before they land, so the sound swells before it stops.
    double envelope = tail;
    if (i < attack) {
      envelope = static_cast<double>(i) / attack;
    } else {
      tail *= fall;
    }
    out[i] = static_cast<float>(0.55 * highpass.process(noise.next()) * envelope);
  }
}

double cowbellSeconds(const Knobs&) { return 0.65; }

void renderCowbell(const Knobs&, double rate, std::uint32_t, float* out, int frames) {
  Square low(540.0, rate);
  Square high(800.0, rate);
  Biquad band = Biquad::bandpass(860.0, 1.4, rate);
  const double strike = decayCoefficient(0.016, rate);
  const double ring = decayCoefficient(0.095, rate);
  double fast = 1.0, slow = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double metal = band.process(0.5 * (low.next() + high.next()));
    out[i] = static_cast<float>(0.95 * saturate(1.5 * metal * (0.6 * fast + 0.4 * slow)));
    fast *= strike;
    slow *= ring;
  }
}

double closedHatSeconds(const Knobs&) { return 0.16; }

void renderClosedHat(const Knobs&, double rate, std::uint32_t, float* out, int frames) {
  MetalBank bank(rate);
  Biquad band = Biquad::bandpass(10000.0, 1.2, rate);
  Biquad highpass = Biquad::highpass(7000.0, 0.8, rate);
  const double fall = decayCoefficient(0.021, rate);
  double amplitude = 1.0;
  for (int i = 0; i < frames; ++i) {
    out[i] = static_cast<float>(saturate(4.4 * highpass.process(band.process(bank.next())) * amplitude));
    amplitude *= fall;
  }
}

double openHatSeconds(const Knobs& knobs) { return 0.03 + 6.9 * sweep(0.07, 0.36, knobs.decay); }

void renderOpenHat(const Knobs& knobs, double rate, std::uint32_t, float* out, int frames) {
  MetalBank bank(rate);
  Biquad band = Biquad::bandpass(10000.0, 1.2, rate);
  Biquad highpass = Biquad::highpass(7000.0, 0.8, rate);
  const double fall = decayCoefficient(sweep(0.07, 0.36, knobs.decay), rate);
  double amplitude = 1.0;
  for (int i = 0; i < frames; ++i) {
    out[i] = static_cast<float>(saturate(4.4 * highpass.process(band.process(bank.next())) * amplitude));
    amplitude *= fall;
  }
}

double cymbalSeconds(const Knobs& knobs) { return 0.05 + 6.9 * sweep(0.28, 0.85, knobs.decay); }

void renderCymbal(const Knobs& knobs, double rate, std::uint32_t, float* out, int frames) {
  MetalBank bank(rate);
  Biquad lowBand = Biquad::bandpass(3440.0, 1.0, rate);
  Biquad highBand = Biquad::bandpass(7100.0, 1.0, rate);
  Biquad highpass = Biquad::highpass(2400.0, 0.7, rate);
  const double seconds = sweep(0.28, 0.85, knobs.decay);
  const double lowFall = decayCoefficient(seconds, rate);
  const double highFall = decayCoefficient(seconds * 0.55, rate);
  const double strikeFall = decayCoefficient(0.028, rate);
  const double lowLevel = lerp(1.0, 0.25, knobs.tone);
  const double highLevel = lerp(0.35, 1.0, knobs.tone);
  double low = 1.0, high = 1.0, strike = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double source = bank.next();
    const double body = lowBand.process(source) * lowLevel * (0.55 * low + 0.45 * strike);
    const double shimmer = highBand.process(source) * highLevel * (0.6 * high + 0.4 * strike);
    out[i] = static_cast<float>(saturate(3.6 * highpass.process(body + shimmer)));
    low *= lowFall;
    high *= highFall;
    strike *= strikeFall;
  }
}

void renderLowTom(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderDrum(kLowTom, k, r, s, o, f); }
void renderMidTom(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderDrum(kMidTom, k, r, s, o, f); }
void renderHighTom(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderDrum(kHighTom, k, r, s, o, f); }
void renderLowConga(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderDrum(kLowConga, k, r, s, o, f); }
void renderMidConga(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderDrum(kMidConga, k, r, s, o, f); }
void renderHighConga(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderDrum(kHighConga, k, r, s, o, f); }

double lowTomSeconds(const Knobs&) { return drumSeconds(kLowTom); }
double midTomSeconds(const Knobs&) { return drumSeconds(kMidTom); }
double highTomSeconds(const Knobs&) { return drumSeconds(kHighTom); }
double lowCongaSeconds(const Knobs&) { return drumSeconds(kLowConga); }
double midCongaSeconds(const Knobs&) { return drumSeconds(kMidConga); }
double highCongaSeconds(const Knobs&) { return drumSeconds(kHighConga); }

// Indexed by SNARE_SOUND_*, which is also the sound slot and the role index.
constexpr Voice kVoices[SNARE_SOUNDS] = {
    {kickSeconds, renderKick, 0x0808'0001u},
    {snareSeconds, renderSnare, 0x0808'0002u},
    {closedHatSeconds, renderClosedHat, 0x0808'0003u},
    {openHatSeconds, renderOpenHat, 0x0808'0004u},
    {lowTomSeconds, renderLowTom, 0x0808'0005u},
    {highTomSeconds, renderHighTom, 0x0808'0006u},
    {clapSeconds, renderClap, 0x0808'0007u},
    {cymbalSeconds, renderCymbal, 0x0808'0008u},
    {midTomSeconds, renderMidTom, 0x0808'0009u},
    {rimShotSeconds, renderRimShot, 0x0808'000au},
    {cowbellSeconds, renderCowbell, 0x0808'000bu},
    {lowCongaSeconds, renderLowConga, 0x0808'000cu},
    {midCongaSeconds, renderMidConga, 0x0808'000du},
    {highCongaSeconds, renderHighConga, 0x0808'000eu},
    {clavesSeconds, renderClaves, 0x0808'000fu},
    {maracasSeconds, renderMaracas, 0x0808'0010u},
};

}  // namespace

const boombapbot::VoiceTable& boombapbot::machineVoices() {
  static constexpr VoiceTable table{kVoices, SNARE_SOUNDS};
  return table;
}
