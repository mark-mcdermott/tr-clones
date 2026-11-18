// The 707's fifteen voices, built from their knob settings.
//
// The machine these stand in for plays short recordings of real drums. None
// of that is here: every voice is synthesised, from a description of how the
// machine sounds (tight, dry, a little grainy, nothing above about ten
// kilohertz), and then passed through `Playback`, which holds each sample for
// a slow converter's tick and rounds it to a few bits. It is a model, and it
// has not been compared with a real machine.
//
// The four knobs mean the same for every voice, though the panel has none of
// them and the project sets them once in its machine file: `tune` is pitch,
// `tone` is brightness or bite, `decay` is length, and `snappy` is the wires
// of the two snare drums and nothing else.
//
// Rules that keep native and WebAssembly renders in agreement:
//   - all arithmetic is double, cast to float once per sample at the end;
//   - the C library's maths works out coefficients only, never a sample;
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

constexpr int kVoiceCount = 15;

// Time for a decay with time constant `seconds` to fall to a thousandth.
double ringSeconds(double seconds) { return 0.02 + 6.9 * seconds; }

double wrap(double phase) { return phase - std::floor(phase); }

// Steps either side of zero: eight bits for the drums, six for the metal.
constexpr double kDrumLevels = 127.0;
constexpr double kMetalLevels = 31.0;

// A sound as a slow converter plays it back: nothing above the band it was
// recorded in, each sample held until the converter's next tick, and rounded
// to the steps it has.
class Playback {
 public:
  Playback(double rate, double levels)
      : before_(Biquad::lowpass(kBandHz, 0.7, rate)),
        after_(Biquad::lowpass(kBandHz, 0.7, rate)),
        tick_(kClockHz / rate),
        levels_(levels) {}

  double process(double input) {
    const double recorded = before_.process(input);
    phase_ += tick_;
    if (phase_ >= 1.0) {
      phase_ -= std::floor(phase_);
      held_ = std::floor(recorded * levels_ + 0.5) / levels_;
    }
    return after_.process(held_);
  }

 private:
  static constexpr double kClockHz = 25000.0;
  static constexpr double kBandHz = 10500.0;

  Biquad before_;
  Biquad after_;
  double tick_;
  double levels_;
  double phase_ = 1.0;
  double held_ = 0.0;
};

// Six squares, ring-modulated in pairs: the metal of the hats, the cymbals
// and the tambourine. `spread` says how far apart the six are.
class Metal {
 public:
  Metal(double hz, const double spread[6], double rate)
      : squares_{Square(hz * spread[0], rate), Square(hz * spread[1], rate), Square(hz * spread[2], rate),
                 Square(hz * spread[3], rate), Square(hz * spread[4], rate), Square(hz * spread[5], rate)} {}

  double next() {
    const double first = squares_[0].next() * squares_[1].next();
    const double second = squares_[2].next() * squares_[3].next();
    const double third = squares_[4].next() * squares_[5].next();
    return (first + second + third) / 3.0;
  }

 private:
  Square squares_[6];
};

constexpr double kHatSpread[6] = {1.0, 1.483, 1.932, 2.546, 3.141, 4.07};
constexpr double kCymbalSpread[6] = {1.0, 1.342, 1.817, 2.263, 2.904, 3.731};

// ---- Bass drums: a sine that drops onto its pitch, and the beater ----------

struct Kick {
  double lowHz;       // tune fully left
  double highHz;      // tune fully right
  double shortest;    // decay fully left
  double longest;     // decay fully right
  double bend;        // how far above its pitch the drum starts
  double bendSeconds;
  double drive;       // how hard the body is pushed into the limiter
  double beaterHz;
  double beater;      // level of the beater's knock
};

constexpr Kick kBassDrum1{44.0, 68.0, 0.045, 0.2, 2.3, 0.014, 1.5, 2400.0, 0.4};
constexpr Kick kBassDrum2{52.0, 80.0, 0.034, 0.15, 3.3, 0.008, 2.5, 3900.0, 0.8};

double kickBody(const Kick& kick, const Knobs& knobs) { return sweep(kick.shortest, kick.longest, knobs.decay); }

void renderKick(const Kick& kick, const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Playback playback(rate, kDrumLevels);
  Biquad beater = Biquad::bandpass(kick.beaterHz * lerp(0.6, 1.5, knobs.tone), 0.9, rate);
  const double hz = sweep(kick.lowHz, kick.highHz, knobs.tune);
  const double body = decayCoefficient(kickBody(kick, knobs), rate);
  const double drop = decayCoefficient(kick.bendSeconds, rate);
  const double knockFall = decayCoefficient(0.0018, rate);
  const double knockLevel = kick.beater * lerp(0.4, 1.7, knobs.tone);
  const double full = saturate(kick.drive);
  double phase = 0.0, amplitude = 1.0, bend = kick.bend, knock = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double thump = saturate(kick.drive * sine(phase) * amplitude) / full;
    const double head = beater.process(noise.next()) * knock * knockLevel;
    out[i] = static_cast<float>(0.95 * playback.process(saturate(thump + head)));
    phase = wrap(phase + hz * (1.0 + bend) / rate);
    amplitude *= body;
    bend *= drop;
    knock *= knockFall;
  }
}

// ---- Snare drums: two modes of the shell under band-passed wires -----------

struct Snare {
  double lowHz;
  double highHz;
  double ratio;      // the shell's second mode, as a multiple of its first
  double shell;      // time constant of the shell
  double shortest;   // wires, decay fully left
  double longest;    // wires, decay fully right
  double darkHz;     // centre of the wires, tone fully left
  double brightHz;   // and fully right
  double crack;      // level of the stick's first millisecond
};

constexpr Snare kSnareDrum1{165.0, 238.0, 1.78, 0.048, 0.04, 0.17, 3000.0, 5800.0, 0.55};
constexpr Snare kSnareDrum2{208.0, 296.0, 1.62, 0.03, 0.03, 0.12, 4400.0, 8000.0, 0.9};

double snareWires(const Snare& snare, const Knobs& knobs) { return sweep(snare.shortest, snare.longest, knobs.decay); }

void renderSnare(const Snare& snare, const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Playback playback(rate, kDrumLevels);
  Biquad band = Biquad::bandpass(lerp(snare.darkHz, snare.brightHz, knobs.tone), 0.7, rate);
  Biquad lift = Biquad::highpass(1100.0, 0.7, rate);
  const double hz = sweep(snare.lowHz, snare.highHz, knobs.tune);
  const double shellFall = decayCoefficient(snare.shell, rate);
  const double wiresFall = decayCoefficient(snareWires(snare, knobs), rate);
  const double bendFall = decayCoefficient(0.006, rate);
  const double crackFall = decayCoefficient(0.0009, rate);
  const double wiresLevel = lerp(0.3, 1.9, knobs.snappy);
  double low = 0.0, high = 0.0, shell = 1.0, wires = 1.0, bend = 0.45, crack = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double hiss = noise.next();
    const double drum = (0.7 * sine(low) + 0.4 * sine(high)) * shell;
    const double under = lift.process(band.process(hiss)) * wires * wiresLevel;
    const double stick = hiss * crack * snare.crack;
    out[i] = static_cast<float>(0.78 * playback.process(saturate(1.25 * (drum + under) + stick)));
    low = wrap(low + hz * (1.0 + bend) / rate);
    high = wrap(high + hz * snare.ratio * (1.0 + bend) / rate);
    shell *= shellFall;
    wires *= wiresFall;
    bend *= bendFall;
    crack *= crackFall;
  }
}

// ---- Toms: a skin with one overtone, and the stick -------------------------

struct Tom {
  double lowHz;
  double highHz;
  double shortest;
  double longest;
};

constexpr Tom kLowTom{74.0, 110.0, 0.062, 0.25};
constexpr Tom kMidTom{104.0, 154.0, 0.053, 0.21};
constexpr Tom kHiTom{144.0, 212.0, 0.045, 0.175};

double tomBody(const Tom& tom, const Knobs& knobs) { return sweep(tom.shortest, tom.longest, knobs.decay); }

void renderTom(const Tom& tom, const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Playback playback(rate, kDrumLevels);
  const double hz = sweep(tom.lowHz, tom.highHz, knobs.tune);
  Biquad stick = Biquad::lowpass(hz * lerp(6.0, 22.0, knobs.tone), 0.7, rate);
  const double body = decayCoefficient(tomBody(tom, knobs), rate);
  const double overtoneFall = decayCoefficient(tomBody(tom, knobs) * 0.35, rate);
  const double drop = decayCoefficient(0.03, rate);
  const double tapFall = decayCoefficient(0.003, rate);
  const double tapLevel = lerp(0.15, 0.9, knobs.tone);
  double phase = 0.0, upper = 0.0, amplitude = 1.0, overtone = 0.3, bend = 0.5, tap = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double skin = sine(phase) * amplitude + sine(upper) * overtone;
    const double wood = stick.process(noise.next()) * tap * tapLevel;
    out[i] = static_cast<float>(0.86 * playback.process(saturate(1.2 * skin + wood)));
    phase = wrap(phase + hz * (1.0 + bend) / rate);
    upper = wrap(upper + hz * 1.58 * (1.0 + bend) / rate);
    amplitude *= body;
    overtone *= overtoneFall;
    bend *= drop;
    tap *= tapFall;
  }
}

// ---- Rim shot: three partials of a struck hoop, and the snap ---------------

double rimBody(const Knobs& knobs) { return sweep(0.007, 0.032, knobs.decay); }
double rimSeconds(const Knobs& knobs) { return ringSeconds(rimBody(knobs)); }

void renderRimShot(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Playback playback(rate, kDrumLevels);
  Biquad snapBand = Biquad::bandpass(lerp(3200.0, 7200.0, knobs.tone), 0.8, rate);
  Biquad lift = Biquad::highpass(260.0, 0.7, rate);
  const double hz = sweep(390.0, 640.0, knobs.tune);
  const double lowFall = decayCoefficient(rimBody(knobs), rate);
  const double midFall = decayCoefficient(rimBody(knobs) * 0.6, rate);
  const double highFall = decayCoefficient(rimBody(knobs) * 0.35, rate);
  const double snapFall = decayCoefficient(0.0008, rate);
  const double snapLevel = lerp(0.5, 2.2, knobs.tone);
  // The partials start at their crests: a rim shot has no way in.
  double first = 0.25, second = 0.25, third = 0.25, low = 1.0, mid = 1.0, high = 1.0, snap = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double hoop = 0.6 * sine(first) * low + 0.5 * sine(second) * mid + 0.4 * sine(third) * high;
    const double crack = snapBand.process(noise.next()) * snap * snapLevel;
    out[i] = static_cast<float>(0.86 * playback.process(saturate(1.4 * lift.process(hoop + crack))));
    first = wrap(first + hz / rate);
    second = wrap(second + hz * 2.31 / rate);
    third = wrap(third + hz * 3.89 / rate);
    low *= lowFall;
    mid *= midFall;
    high *= highFall;
    snap *= snapFall;
  }
}

// ---- Cowbell: two squares a fifth apart, struck and left to ring -----------

double cowbellRing(const Knobs& knobs) { return sweep(0.035, 0.15, knobs.decay); }
double cowbellSeconds(const Knobs& knobs) { return ringSeconds(cowbellRing(knobs)); }

void renderCowbell(const Knobs& knobs, double rate, std::uint32_t, float* out, int frames) {
  Playback playback(rate, kDrumLevels);
  const double hz = sweep(500.0, 670.0, knobs.tune);
  Square low(hz, rate);
  Square high(hz * 1.504, rate);
  Biquad mouth = Biquad::bandpass(hz * lerp(1.8, 4.6, knobs.tone), 1.5, rate);
  Biquad lift = Biquad::highpass(hz * 0.8, 0.7, rate);
  const double strikeFall = decayCoefficient(0.007, rate);
  const double ringFall = decayCoefficient(cowbellRing(knobs), rate);
  double strike = 1.0, ring = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double bell = 0.5 * (low.next() + high.next());
    const double voiced = mouth.process(bell) + 0.3 * lift.process(bell);
    out[i] = static_cast<float>(0.86 * playback.process(saturate(1.7 * voiced * (0.55 * strike + 0.45 * ring))));
    strike *= strikeFall;
    ring *= ringFall;
  }
}

// ---- Hand clap: four hands a few milliseconds apart, and a short room ------

double clapRoom(const Knobs& knobs) { return sweep(0.03, 0.15, knobs.decay); }
double clapSeconds(const Knobs& knobs) { return 0.03 + ringSeconds(clapRoom(knobs)); }

void renderClap(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Playback playback(rate, kDrumLevels);
  Biquad band = Biquad::bandpass(sweep(900.0, 1550.0, knobs.tune), lerp(1.9, 0.9, knobs.tone), rate);
  Biquad lift = Biquad::highpass(lerp(450.0, 1100.0, knobs.tone), 0.7, rate);
  const double handFall = decayCoefficient(0.0028, rate);
  const double roomFall = decayCoefficient(clapRoom(knobs), rate);
  const int gap = static_cast<int>(0.0085 * rate);
  double hand = 1.0, room = 0.0;
  for (int i = 0; i < frames; ++i) {
    // Each hand starts the envelope again; the last one lets the room go.
    if (i == gap || i == 2 * gap) hand = 1.0;
    if (i == 3 * gap) room = 0.75;
    const double envelope = i < 3 * gap ? hand : room;
    out[i] = static_cast<float>(0.86 * playback.process(saturate(4.8 * lift.process(band.process(noise.next())) * envelope)));
    hand *= handFall;
    room *= roomFall;
  }
}

// ---- Tambourine: the frame is hit, then the jingles land ------------------

double tambourineRing(const Knobs& knobs) { return sweep(0.03, 0.16, knobs.decay); }
double tambourineSeconds(const Knobs& knobs) { return 0.03 + ringSeconds(tambourineRing(knobs)); }

void renderTambourine(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Playback playback(rate, kMetalLevels);
  Metal jingles(sweep(1350.0, 1950.0, knobs.tune), kCymbalSpread, rate);
  Biquad band = Biquad::bandpass(lerp(6200.0, 9800.0, knobs.tone), 1.1, rate);
  Biquad lift = Biquad::highpass(lerp(3800.0, 6500.0, knobs.tone), 0.8, rate);
  const double hitFall = decayCoefficient(0.009, rate);
  const double ringFall = decayCoefficient(tambourineRing(knobs), rate);
  const int landing = static_cast<int>(0.021 * rate);
  double hit = 1.0, ring = 0.0;
  for (int i = 0; i < frames; ++i) {
    if (i == landing) ring = 1.0;
    const double source = 0.7 * jingles.next() + 0.5 * noise.next();
    const double shaken = playback.process(saturate(3.4 * lift.process(band.process(source))));
    out[i] = static_cast<float>(0.82 * shaken * (hit > ring ? hit : ring));
    hit *= hitFall;
    ring *= ringFall;
  }
}

// ---- Hi-hats: one stretch of metal behind two envelopes ---------------------

struct Hat {
  double shortest;
  double longest;
};

constexpr Hat kClosedHat{0.011, 0.05};
constexpr Hat kOpenHat{0.09, 0.44};

double hatFall(const Hat& hat, const Knobs& knobs) { return sweep(hat.shortest, hat.longest, knobs.decay); }

void renderHat(const Hat& hat, const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Playback playback(rate, kMetalLevels);
  Metal metal(sweep(350.0, 540.0, knobs.tune), kHatSpread, rate);
  Biquad band = Biquad::bandpass(lerp(7000.0, 10000.0, knobs.tone), 1.0, rate);
  Biquad lift = Biquad::highpass(lerp(5200.0, 8200.0, knobs.tone), 0.8, rate);
  const double fall = decayCoefficient(hatFall(hat, knobs), rate);
  double amplitude = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double source = 0.8 * metal.next() + 0.3 * noise.next();
    // The converter plays the metal at full scale; the envelope comes after it.
    const double played = playback.process(saturate(4.0 * lift.process(band.process(source))));
    out[i] = static_cast<float>(0.82 * played * amplitude);
    amplitude *= fall;
  }
}

// ---- Crash: noise and metal, bright at the stroke and long in the wash -----

double crashWash(const Knobs& knobs) { return sweep(0.16, 0.7, knobs.decay); }
double crashSeconds(const Knobs& knobs) { return ringSeconds(crashWash(knobs)); }

void renderCrash(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Playback playback(rate, kMetalLevels);
  Metal metal(sweep(250.0, 380.0, knobs.tune), kCymbalSpread, rate);
  Biquad lift = Biquad::highpass(lerp(2200.0, 4600.0, knobs.tone), 0.7, rate);
  Biquad air = Biquad::bandpass(lerp(5200.0, 8600.0, knobs.tone), 0.6, rate);
  const double strokeFall = decayCoefficient(0.05, rate);
  const double washFall = decayCoefficient(crashWash(knobs), rate);
  double stroke = 1.0, wash = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double source = 0.6 * noise.next() + 0.55 * metal.next();
    const double bronze = lift.process(source);
    const double played = playback.process(saturate(2.2 * (0.6 * bronze + air.process(bronze))));
    out[i] = static_cast<float>(0.82 * played * (0.45 * stroke + 0.55 * wash));
    stroke *= strokeFall;
    wash *= washFall;
  }
}

// ---- Ride: the tip of the stick on the bow, over a narrower wash -----------

double rideWash(const Knobs& knobs) { return sweep(0.18, 0.75, knobs.decay); }
double rideSeconds(const Knobs& knobs) { return ringSeconds(rideWash(knobs)); }

void renderRide(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Playback playback(rate, kMetalLevels);
  const double hz = sweep(400.0, 580.0, knobs.tune);
  Metal metal(hz, kHatSpread, rate);
  Biquad bow = Biquad::bandpass(lerp(5200.0, 8200.0, knobs.tone), 2.2, rate);
  Biquad lift = Biquad::highpass(3000.0, 0.7, rate);
  const double pingFall = decayCoefficient(rideWash(knobs) * 0.28, rate);
  const double tipFall = decayCoefficient(0.0035, rate);
  const double washFall = decayCoefficient(rideWash(knobs), rate);
  const double tipLevel = lerp(0.25, 0.8, knobs.tone);
  double bell = 0.0, upper = 0.0, ping = 1.0, tip = 1.0, wash = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double source = 0.85 * metal.next() + 0.2 * noise.next();
    const double played = playback.process(saturate(5.0 * lift.process(bow.process(source))));
    const double struck = (0.2 * sine(bell) + 0.13 * sine(upper)) * ping;
    out[i] = static_cast<float>(0.8 * saturate(played * (0.6 * wash + tipLevel * tip) + struck));
    bell = wrap(bell + hz * 7.31 / rate);
    upper = wrap(upper + hz * 11.57 / rate);
    ping *= pingFall;
    tip *= tipFall;
    wash *= washFall;
  }
}

// ---- The table --------------------------------------------------------------

double bassDrum1Seconds(const Knobs& knobs) { return ringSeconds(kickBody(kBassDrum1, knobs)); }
double bassDrum2Seconds(const Knobs& knobs) { return ringSeconds(kickBody(kBassDrum2, knobs)); }
double snareDrum1Seconds(const Knobs& knobs) { return ringSeconds(snareWires(kSnareDrum1, knobs)); }
double snareDrum2Seconds(const Knobs& knobs) { return ringSeconds(snareWires(kSnareDrum2, knobs)); }
double lowTomSeconds(const Knobs& knobs) { return ringSeconds(tomBody(kLowTom, knobs)); }
double midTomSeconds(const Knobs& knobs) { return ringSeconds(tomBody(kMidTom, knobs)); }
double hiTomSeconds(const Knobs& knobs) { return ringSeconds(tomBody(kHiTom, knobs)); }
double closedHatSeconds(const Knobs& knobs) { return ringSeconds(hatFall(kClosedHat, knobs)); }
double openHatSeconds(const Knobs& knobs) { return ringSeconds(hatFall(kOpenHat, knobs)); }

void renderBassDrum1(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderKick(kBassDrum1, k, r, s, o, f); }
void renderBassDrum2(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderKick(kBassDrum2, k, r, s, o, f); }
void renderSnareDrum1(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderSnare(kSnareDrum1, k, r, s, o, f); }
void renderSnareDrum2(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderSnare(kSnareDrum2, k, r, s, o, f); }
void renderLowTom(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderTom(kLowTom, k, r, s, o, f); }
void renderMidTom(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderTom(kMidTom, k, r, s, o, f); }
void renderHiTom(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderTom(kHiTom, k, r, s, o, f); }
void renderClosedHat(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderHat(kClosedHat, k, r, s, o, f); }
void renderOpenHat(const Knobs& k, double r, std::uint32_t s, float* o, int f) { renderHat(kOpenHat, k, r, s, o, f); }

// A voice's place here is its sound number and its sound slot, in the order
// of the step keys that choose them. Never reorder.
constexpr Voice kVoices[kVoiceCount] = {
    {bassDrum1Seconds, renderBassDrum1, 0x0707'0001u},
    {bassDrum2Seconds, renderBassDrum2, 0x0707'0002u},
    {snareDrum1Seconds, renderSnareDrum1, 0x0707'0003u},
    {snareDrum2Seconds, renderSnareDrum2, 0x0707'0004u},
    {lowTomSeconds, renderLowTom, 0x0707'0005u},
    {midTomSeconds, renderMidTom, 0x0707'0006u},
    {hiTomSeconds, renderHiTom, 0x0707'0007u},
    {rimSeconds, renderRimShot, 0x0707'0008u},
    {cowbellSeconds, renderCowbell, 0x0707'0009u},
    {clapSeconds, renderClap, 0x0707'000au},
    {tambourineSeconds, renderTambourine, 0x0707'000bu},
    {closedHatSeconds, renderClosedHat, 0x0707'000cu},
    {openHatSeconds, renderOpenHat, 0x0707'000du},
    {crashSeconds, renderCrash, 0x0707'000eu},
    {rideSeconds, renderRide, 0x0707'000fu},
};

}  // namespace

const boombapbot::VoiceTable& boombapbot::machineVoices() {
  static constexpr VoiceTable table{kVoices, kVoiceCount};
  return table;
}
