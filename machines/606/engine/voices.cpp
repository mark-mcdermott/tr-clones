// The 606's seven voices. The machine has no knob that shapes a sound, only
// levels, so each voice is one fixed sound and the engine's four knobs are
// ignored.
//
// This is a model made from general descriptions of small analogue drum
// circuits: damped tuned oscillators for the drums, high-passed noise for
// the snare, and six square waves through band filters for the cymbal and
// the hi-hats. It is meant to be thin, short and bright beside the 808. Its
// lengths, levels and brightness were measured; nobody has listened to it
// yet or compared it with a real machine, and nothing here is sampled from
// one.
//
// Rules that keep native and WebAssembly renders in agreement:
//   - all arithmetic is double, cast to float once per sample at the end;
//   - the C library's maths is used only to work out coefficients, never
//     inside a per-sample loop;
//   - noise comes from the integer generator in dsp.h;
//   - a sound's length comes from plain arithmetic; the engine fades its tail.

#include <cmath>
#include <cstdint>

#include "boombapbot/dsp.h"
#include "boombapbot/voices.h"

namespace {

using boombapbot::Knobs;
using boombapbot::Voice;
using namespace boombapbot::dsp;

constexpr int kVoiceCount = 7;

// Time for a decay with time constant `seconds` to fall to a thousandth.
constexpr double ringSeconds(double seconds) { return 0.02 + 6.9 * seconds; }

double wrap(double phase) { return phase - std::floor(phase); }

// The six square waves under the cymbal and both hi-hats.
class MetalBank {
 public:
  explicit MetalBank(double rate)
      : squares_{Square(245.0, rate), Square(306.0, rate), Square(365.0, rate),
                 Square(415.0, rate), Square(437.0, rate), Square(619.0, rate)} {}
  double next() {
    double sum = 0.0;
    for (Square& square : squares_) sum += square.next();
    return sum / 6.0;
  }

 private:
  Square squares_[6];
};

// ---- Bass drum: a short sine that drops onto its pitch, with a knock -------

constexpr double kKickBody = 0.075;

double kickSeconds(const Knobs&) { return ringSeconds(kKickBody); }

void renderKick(const Knobs&, double rate, std::uint32_t, float* out, int frames) {
  const double body = decayCoefficient(kKickBody, rate);
  const double drop = decayCoefficient(0.009, rate);
  const double knockFall = decayCoefficient(0.014, rate);
  const double clickFall = decayCoefficient(0.0011, rate);
  Biquad clickFilter = Biquad::lowpass(4200.0, 0.7, rate);
  // Nothing below the drum itself: this is what keeps it thin.
  Biquad thin = Biquad::highpass(44.0, 0.7, rate);
  double phase = 0.0, knockPhase = 0.0, amplitude = 1.0, bend = 1.5, knock = 1.0, click = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double drum = sine(phase) * amplitude + 0.3 * sine(knockPhase) * knock;
    const double transient = 0.45 * clickFilter.process(click);
    out[i] = static_cast<float>(0.86 * saturate(1.1 * thin.process(drum + transient)));
    phase = wrap(phase + 62.0 * (1.0 + bend) / rate);
    knockPhase = wrap(knockPhase + 148.0 / rate);
    amplitude *= body;
    bend *= drop;
    knock *= knockFall;
    click *= clickFall;
  }
}

// ---- Snare drum: a brief shell under bright noise --------------------------

constexpr double kSnareWires = 0.06;

double snareSeconds(const Knobs&) { return ringSeconds(kSnareWires); }

void renderSnare(const Knobs&, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  const double shellFall = decayCoefficient(0.034, rate);
  const double wiresFall = decayCoefficient(kSnareWires, rate);
  const double bendFall = decayCoefficient(0.005, rate);
  Biquad lift = Biquad::highpass(3100.0, 0.8, rate);
  Biquad top = Biquad::lowpass(11000.0, 0.7, rate);
  double phase = 0.0, shell = 1.0, wires = 1.0, bend = 0.3;
  for (int i = 0; i < frames; ++i) {
    const double drum = 0.7 * sine(phase) * shell;
    const double hiss = 1.25 * top.process(lift.process(noise.next())) * wires;
    out[i] = static_cast<float>(0.8 * saturate(drum + hiss));
    phase = wrap(phase + 196.0 * (1.0 + bend) / rate);
    shell *= shellFall;
    wires *= wiresFall;
    bend *= bendFall;
  }
}

// ---- Toms: one small drum at two pitches, with a little air under it -------

struct Tom {
  double hz;
  double seconds;  // time constant of the body
};

constexpr Tom kLowTom{122.0, 0.1};
constexpr Tom kHighTom{186.0, 0.08};

void renderTom(const Tom& tom, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  const double body = decayCoefficient(tom.seconds, rate);
  const double drop = decayCoefficient(0.02, rate);
  const double airFall = decayCoefficient(tom.seconds * 0.5, rate);
  Biquad airBand = Biquad::bandpass(tom.hz * 9.0, 0.8, rate);
  double phase = 0.0, amplitude = 1.0, bend = 0.4, air = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double skin = sine(phase) * amplitude;
    const double under = 0.22 * airBand.process(noise.next()) * air;
    out[i] = static_cast<float>(0.82 * saturate(skin + under));
    phase = wrap(phase + tom.hz * (1.0 + bend) / rate);
    amplitude *= body;
    bend *= drop;
    air *= airFall;
  }
}

double lowTomSeconds(const Knobs&) { return ringSeconds(kLowTom.seconds); }
double highTomSeconds(const Knobs&) { return ringSeconds(kHighTom.seconds); }
void renderLowTom(const Knobs&, double r, std::uint32_t s, float* o, int f) { renderTom(kLowTom, r, s, o, f); }
void renderHighTom(const Knobs&, double r, std::uint32_t s, float* o, int f) { renderTom(kHighTom, r, s, o, f); }

// ---- Cymbal: the metal through two bands, the upper one fading first -------

constexpr double kCymbalRing = 0.27;

double cymbalSeconds(const Knobs&) { return 0.04 + ringSeconds(kCymbalRing); }

void renderCymbal(const Knobs&, double rate, std::uint32_t, float* out, int frames) {
  MetalBank bank(rate);
  Biquad lowBand = Biquad::bandpass(4600.0, 1.1, rate);
  Biquad highBand = Biquad::bandpass(8800.0, 1.0, rate);
  Biquad cut = Biquad::highpass(3600.0, 0.7, rate);
  const double lowFall = decayCoefficient(kCymbalRing, rate);
  const double highFall = decayCoefficient(kCymbalRing * 0.5, rate);
  const double strikeFall = decayCoefficient(0.02, rate);
  double low = 1.0, high = 1.0, strike = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double metal = bank.next();
    const double body = 0.7 * lowBand.process(metal) * (0.6 * low + 0.4 * strike);
    const double shimmer = highBand.process(metal) * (0.65 * high + 0.35 * strike);
    out[i] = static_cast<float>(0.82 * saturate(4.2 * cut.process(body + shimmer)));
    low *= lowFall;
    high *= highFall;
    strike *= strikeFall;
  }
}

// ---- Hi-hats: the same metal, high-passed; only the length differs ---------

constexpr double kOpenHatRing = 0.1;
constexpr double kClosedHatRing = 0.015;

void renderHat(double ring, double rate, float* out, int frames) {
  MetalBank bank(rate);
  Biquad band = Biquad::bandpass(9200.0, 1.2, rate);
  Biquad cut = Biquad::highpass(7400.0, 0.8, rate);
  const double fall = decayCoefficient(ring, rate);
  double amplitude = 1.0;
  for (int i = 0; i < frames; ++i) {
    out[i] = static_cast<float>(0.84 * saturate(5.0 * cut.process(band.process(bank.next())) * amplitude));
    amplitude *= fall;
  }
}

double openHatSeconds(const Knobs&) { return ringSeconds(kOpenHatRing); }
double closedHatSeconds(const Knobs&) { return ringSeconds(kClosedHatRing); }
void renderOpenHat(const Knobs&, double r, std::uint32_t, float* o, int f) { renderHat(kOpenHatRing, r, o, f); }
void renderClosedHat(const Knobs&, double r, std::uint32_t, float* o, int f) { renderHat(kClosedHatRing, r, o, f); }

// A voice's place here is its sound number and its sound slot, in the order
// of the instrument selector. Never reorder.
constexpr Voice kVoices[kVoiceCount] = {
    {kickSeconds, renderKick, 0x0606'0001u},
    {snareSeconds, renderSnare, 0x0606'0002u},
    {lowTomSeconds, renderLowTom, 0x0606'0003u},
    {highTomSeconds, renderHighTom, 0x0606'0004u},
    {cymbalSeconds, renderCymbal, 0x0606'0005u},
    {openHatSeconds, renderOpenHat, 0x0606'0006u},
    {closedHatSeconds, renderClosedHat, 0x0606'0007u},
};

}  // namespace

const boombapbot::VoiceTable& boombapbot::machineVoices() {
  static constexpr VoiceTable table{kVoices, kVoiceCount};
  return table;
}
