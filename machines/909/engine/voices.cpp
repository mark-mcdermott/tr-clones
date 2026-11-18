// The 909's eleven voices, built from their knob settings.
//
// This is a model made from general descriptions of the machine: a
// bass drum that sweeps down onto its pitch behind a click, a snare of two
// tuned oscillators under bright noise, toms that drop, a clap of four
// bursts and a room, and hats and cymbals that are a bank of ring-modulated
// squares put through a coarse converter. On the machine the hats and
// cymbals were short recordings; nothing here is sampled. Its lengths, levels
// and brightness were measured; nobody has listened to it yet or compared it
// with a real machine.
//
// The engine's four knobs are named for its first machine. Here `tone` is the
// bass drum's ATTACK and the snare's TONE, and `snappy` is the snare's alone.
// A knob a voice does not have on the panel does nothing to it.
//
// Rules that keep native and WebAssembly renders in agreement:
//   - all arithmetic is double, cast to float once per sample at the end;
//   - the C library's sin, cos, exp and pow are used only to work out
//     coefficients, never inside a per-sample loop;
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

constexpr int kVoiceCount = 11;

// Time for a decay with time constant `seconds` to fall to a thousandth.
double ringSeconds(double seconds) { return 0.02 + 6.9 * seconds; }

double wrap(double phase) { return phase - std::floor(phase); }

// ---- BASS DRUM: a sine that sweeps down onto its pitch, behind a click -----

double bassDrumBody(const Knobs& knobs) { return sweep(0.07, 0.48, knobs.decay); }
double bassDrumSeconds(const Knobs& knobs) { return ringSeconds(bassDrumBody(knobs)); }

void renderBassDrum(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  const double hz = sweep(43.0, 61.0, knobs.tune);
  const double body = decayCoefficient(bassDrumBody(knobs), rate);
  // TUNE is how long the sweep takes as much as where it lands.
  const double drop = decayCoefficient(sweep(0.013, 0.046, knobs.tune), rate);
  const double clickFall = decayCoefficient(0.0021, rate);
  const double thumpFall = decayCoefficient(0.0007, rate);
  Biquad clickBand = Biquad::bandpass(3400.0, 0.7, rate);
  const double clickLevel = lerp(0.0, 1.5, knobs.tone);
  const double thumpLevel = lerp(0.0, 0.55, knobs.tone);
  double phase = 0.0, amplitude = 1.0, bend = 4.6, click = 1.0, thump = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double drum = saturate(1.9 * sine(phase) * amplitude) / saturate(1.9);
    const double attack = clickBand.process(noise.next()) * click * clickLevel + thump * thumpLevel;
    out[i] = static_cast<float>(0.92 * saturate(drum + attack));
    phase = wrap(phase + hz * (1.0 + bend) / rate);
    amplitude *= body;
    bend *= drop;
    click *= clickFall;
    thump *= thumpFall;
  }
}

// ---- SNARE DRUM: two tuned oscillators and bright noise ---------------------

double snareNoise(const Knobs& knobs) { return lerp(0.075, 0.2, knobs.tone); }
double snareSeconds(const Knobs& knobs) { return ringSeconds(snareNoise(knobs)); }

void renderSnareDrum(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  const double hz = sweep(160.0, 262.0, knobs.tune);
  const double lowFall = decayCoefficient(0.07, rate);
  const double highFall = decayCoefficient(0.042, rate);
  const double bendFall = decayCoefficient(0.0085, rate);
  const double noiseFall = decayCoefficient(snareNoise(knobs), rate);
  Biquad under = Biquad::lowpass(4200.0, 0.7, rate);
  Biquad snapLift = Biquad::highpass(lerp(1500.0, 3200.0, knobs.tone), 0.8, rate);
  Biquad snapTop = Biquad::lowpass(lerp(7000.0, 14000.0, knobs.tone), 0.7, rate);
  const double snapLevel = lerp(0.04, 1.25, knobs.snappy);
  double low = 0.0, high = 0.0, lowLevel = 1.0, highLevel = 1.0, bend = 0.6, hiss = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double shell = 0.8 * sine(low) * lowLevel + 0.5 * sine(high) * highLevel;
    const double white = noise.next();
    const double wires = (0.22 * under.process(white) + snapLevel * snapTop.process(snapLift.process(white))) * hiss;
    out[i] = static_cast<float>(0.9 * saturate(1.35 * (shell + wires)));
    low = wrap(low + hz * (1.0 + bend) / rate);
    high = wrap(high + hz * 1.62 * (1.0 + bend) / rate);
    lowLevel *= lowFall;
    highLevel *= highFall;
    bend *= bendFall;
    hiss *= noiseFall;
  }
}

// ---- LOW, MID and HI TOM: three partials that drop, and a little skin ------

struct Tom {
  double lowHz;       // TUNE fully left
  double highHz;      // TUNE fully right
  double shortest;    // DECAY fully left
  double longest;     // DECAY fully right
  double dropSeconds;
};

constexpr Tom kLowTom{76.0, 132.0, 0.085, 0.5, 0.042};
constexpr Tom kMidTom{106.0, 184.0, 0.075, 0.42, 0.036};
constexpr Tom kHiTom{148.0, 256.0, 0.065, 0.34, 0.03};

double tomBody(const Tom& tom, const Knobs& knobs) { return sweep(tom.shortest, tom.longest, knobs.decay); }

void renderTom(const Tom& tom, const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  const double hz = sweep(tom.lowHz, tom.highHz, knobs.tune);
  const double seconds = tomBody(tom, knobs);
  const double body = decayCoefficient(seconds, rate);
  const double second = decayCoefficient(seconds * 0.45, rate);
  const double third = decayCoefficient(seconds * 0.22, rate);
  const double drop = decayCoefficient(tom.dropSeconds, rate);
  const double skinFall = decayCoefficient(0.012, rate);
  Biquad skinFilter = Biquad::lowpass(hz * 9.0, 0.7, rate);
  double first = 0.0, upper = 0.0, top = 0.0;
  double amplitude = 1.0, upperLevel = 1.0, topLevel = 1.0, bend = 0.95, skin = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double drum =
        sine(first) * amplitude + 0.32 * sine(upper) * upperLevel + 0.18 * sine(top) * topLevel;
    const double slap = 0.5 * skinFilter.process(noise.next()) * skin;
    out[i] = static_cast<float>(0.9 * saturate(1.5 * (drum + slap)) / saturate(1.5));
    const double turn = hz * (1.0 + bend) / rate;
    first = wrap(first + turn);
    upper = wrap(upper + turn * 1.51);
    top = wrap(top + turn * 2.23);
    amplitude *= body;
    upperLevel *= second;
    topLevel *= third;
    bend *= drop;
    skin *= skinFall;
  }
}

double lowTomSeconds(const Knobs& knobs) { return ringSeconds(tomBody(kLowTom, knobs)); }
double midTomSeconds(const Knobs& knobs) { return ringSeconds(tomBody(kMidTom, knobs)); }
double hiTomSeconds(const Knobs& knobs) { return ringSeconds(tomBody(kHiTom, knobs)); }
void renderLowTom(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderTom(kLowTom, k, r, s, o, f); }
void renderMidTom(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderTom(kMidTom, k, r, s, o, f); }
void renderHiTom(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderTom(kHiTom, k, r, s, o, f); }

// ---- RIM SHOT: three short rings driven hard into the limiter --------------

double rimShotSeconds(const Knobs&) { return 0.11; }

void renderRimShot(const Knobs&, double rate, std::uint32_t, float* out, int frames) {
  const double lowFall = decayCoefficient(0.011, rate);
  const double midFall = decayCoefficient(0.008, rate);
  const double highFall = decayCoefficient(0.0052, rate);
  Biquad lift = Biquad::highpass(190.0, 0.7, rate);
  double low = 0.0, mid = 0.0, high = 0.0, lowLevel = 1.0, midLevel = 1.0, highLevel = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double knock = 0.55 * sine(low) * lowLevel + 0.8 * sine(mid) * midLevel + 0.9 * sine(high) * highLevel;
    out[i] = static_cast<float>(0.56 * lift.process(saturate(3.2 * knock)));
    low = wrap(low + 223.0 / rate);
    mid = wrap(mid + 498.0 / rate);
    high = wrap(high + 1021.0 / rate);
    lowLevel *= lowFall;
    midLevel *= midFall;
    highLevel *= highFall;
  }
}

// ---- HAND CLAP: four bursts of noise, then the room -------------------------

constexpr double kClapRoom = 0.1;

double handClapSeconds(const Knobs&) { return 0.04 + ringSeconds(kClapRoom); }

void renderHandClap(const Knobs&, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Biquad body = Biquad::bandpass(1150.0, 1.1, rate);
  Biquad edge = Biquad::bandpass(2700.0, 1.4, rate);
  Biquad lift = Biquad::highpass(480.0, 0.7, rate);
  const double burstFall = decayCoefficient(0.0042, rate);
  const double roomFall = decayCoefficient(kClapRoom, rate);
  const int gap = static_cast<int>(0.0098 * rate);
  double burst = 1.0, room = 0.0;
  for (int i = 0; i < frames; ++i) {
    // Each burst starts the envelope again; the last one lets the room go.
    if (i == gap || i == 2 * gap || i == 3 * gap) burst = 1.0;
    if (i == 3 * gap) room = 0.8;
    const double envelope = burst > room ? burst : room;
    const double white = noise.next();
    const double hands = lift.process(body.process(white) + 0.7 * edge.process(white));
    out[i] = static_cast<float>(0.9 * saturate(3.6 * hands * envelope));
    burst *= burstFall;
    room *= roomFall;
  }
}

// ---- Metal: what the hats and cymbals are made of ---------------------------

// Six squares, ring-modulated in pairs, with noise under them.
class Metal {
 public:
  Metal(double scale, double rate, std::uint32_t seed)
      : squares_{Square(419.0 * scale, rate), Square(617.0 * scale, rate), Square(733.0 * scale, rate),
                 Square(1069.0 * scale, rate), Square(1307.0 * scale, rate), Square(1811.0 * scale, rate)},
        noise_(seed) {}
  double next() {
    const double first = squares_[0].next() * squares_[3].next();
    const double second = squares_[1].next() * squares_[4].next();
    const double third = squares_[2].next() * squares_[5].next();
    return 0.24 * (first + second + third) + 0.28 * noise_.next();
  }

 private:
  Square squares_[6];
  Noise noise_;
};

// Holds each sample for a fixed time and rounds it to a few levels, as an
// early sampler's converter does. This is the grain in the hats and cymbals.
class Converter {
 public:
  Converter(double hz, double rate, double levels) : step_(hz < rate ? hz / rate : 1.0), levels_(levels) {}
  double process(double input) {
    phase_ += step_;
    if (phase_ >= 1.0) {
      phase_ -= 1.0;
      held_ = std::floor(input * levels_ + 0.5) / levels_;
    }
    return held_;
  }

 private:
  double step_;
  double levels_;
  double phase_ = 1.0;
  double held_ = 0.0;
};

// ---- CLOSED and OPEN HI-HAT ---------------------------------------------------

struct Hat {
  double shortest;  // DECAY fully left
  double longest;   // DECAY fully right
};

constexpr Hat kClosedHat{0.014, 0.075};
constexpr Hat kOpenHat{0.09, 0.42};

double hatFall(const Hat& hat, const Knobs& knobs) { return sweep(hat.shortest, hat.longest, knobs.decay); }

void renderHat(const Hat& hat, const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Metal metal(1.0, rate, seed);
  Converter converter(27000.0, rate, 24.0);
  Biquad lift = Biquad::highpass(6200.0, 0.8, rate);
  Biquad air = Biquad::bandpass(9200.0, 0.9, rate);
  const double fall = decayCoefficient(hatFall(hat, knobs), rate);
  const double strikeFall = decayCoefficient(0.006, rate);
  double amplitude = 1.0, strike = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double grain = converter.process(metal.next());
    const double bright = lift.process(grain) + 0.8 * air.process(grain);
    out[i] = static_cast<float>(0.88 * saturate(3.0 * bright * (0.75 * amplitude + 0.25 * strike)));
    amplitude *= fall;
    strike *= strikeFall;
  }
}

double closedHatSeconds(const Knobs& knobs) { return ringSeconds(hatFall(kClosedHat, knobs)); }
double openHatSeconds(const Knobs& knobs) { return ringSeconds(hatFall(kOpenHat, knobs)); }
void renderClosedHat(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderHat(kClosedHat, k, r, s, o, f); }
void renderOpenHat(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderHat(kOpenHat, k, r, s, o, f); }

// ---- CRASH and RIDE -----------------------------------------------------------

// TUNE plays a cymbal faster or slower, as it would a recording: higher is shorter.
double cymbalSpeed(const Knobs& knobs) { return sweep(0.78, 1.28, knobs.tune); }

constexpr double kCrashRing = 0.34;
constexpr double kRideRing = 0.4;

double crashSeconds(const Knobs& knobs) { return 0.05 + 6.9 * kCrashRing / cymbalSpeed(knobs); }

void renderCrash(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  const double speed = cymbalSpeed(knobs);
  Metal metal(0.86 * speed, rate, seed);
  Converter converter(24000.0 * speed, rate, 28.0);
  Biquad lift = Biquad::highpass(3100.0 * speed, 0.7, rate);
  Biquad shimmer = Biquad::bandpass(7600.0 * speed, 0.8, rate);
  const double ring = decayCoefficient(kCrashRing / speed, rate);
  const double washFall = decayCoefficient(0.09 / speed, rate);
  const double strikeFall = decayCoefficient(0.012 / speed, rate);
  double slow = 1.0, wash = 1.0, strike = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double grain = converter.process(metal.next());
    const double bright = lift.process(grain) + 0.9 * shimmer.process(grain);
    out[i] = static_cast<float>(0.88 * saturate(2.6 * bright * (0.5 * slow + 0.3 * wash + 0.2 * strike)));
    slow *= ring;
    wash *= washFall;
    strike *= strikeFall;
  }
}

double rideSeconds(const Knobs& knobs) { return 0.05 + 6.9 * kRideRing / cymbalSpeed(knobs); }

void renderRide(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  const double speed = cymbalSpeed(knobs);
  Metal metal(1.18 * speed, rate, seed);
  Converter converter(24000.0 * speed, rate, 28.0);
  Biquad lift = Biquad::highpass(4600.0 * speed, 0.8, rate);
  Biquad band = Biquad::bandpass(6400.0 * speed, 1.6, rate);
  const double ring = decayCoefficient(kRideRing / speed, rate);
  const double pingFall = decayCoefficient(0.022 / speed, rate);
  const double bellFall = decayCoefficient(0.16 / speed, rate);
  double slow = 1.0, ping = 1.0, bellLevel = 1.0, bell = 0.0, overtone = 0.0;
  for (int i = 0; i < frames; ++i) {
    const double grain = converter.process(metal.next());
    const double wash = (0.6 * lift.process(grain) + 1.3 * band.process(grain)) * (0.42 * slow + 0.58 * ping);
    const double stick = (0.05 * sine(bell) + 0.035 * sine(overtone)) * bellLevel;
    out[i] = static_cast<float>(0.88 * saturate(2.9 * (wash + stick)));
    bell = wrap(bell + 3020.0 * speed / rate);
    overtone = wrap(overtone + 4470.0 * speed / rate);
    slow *= ring;
    ping *= pingFall;
    bellLevel *= bellFall;
  }
}

// A voice's place here is its sound number, its slot and, plus one, its
// engine track, as data/909.machine.json lists them. Never reorder.
constexpr Voice kVoices[kVoiceCount] = {
    {bassDrumSeconds, renderBassDrum, 0x0909'0001u},
    {snareSeconds, renderSnareDrum, 0x0909'0002u},
    {lowTomSeconds, renderLowTom, 0x0909'0003u},
    {midTomSeconds, renderMidTom, 0x0909'0004u},
    {hiTomSeconds, renderHiTom, 0x0909'0005u},
    {rimShotSeconds, renderRimShot, 0x0909'0006u},
    {handClapSeconds, renderHandClap, 0x0909'0007u},
    {closedHatSeconds, renderClosedHat, 0x0909'0008u},
    {openHatSeconds, renderOpenHat, 0x0909'0009u},
    {crashSeconds, renderCrash, 0x0909'000au},
    {rideSeconds, renderRide, 0x0909'000bu},
};

}  // namespace

const boombapbot::VoiceTable& boombapbot::machineVoices() {
  static constexpr VoiceTable table{kVoices, kVoiceCount};
  return table;
}
