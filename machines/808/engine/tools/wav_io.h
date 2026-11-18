// PCM WAV reading and writing for the engine's tools and tests. Not part of
// the render core, which only ever sees float buffers.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace snare::wav {

struct Audio {
  std::vector<float> pcm;  // interleaved
  int channels = 0;
  int frames = 0;
  double sampleRate = 0.0;
};

namespace detail {

inline std::uint32_t u32(const std::uint8_t* p) {
  return static_cast<std::uint32_t>(p[0]) | (static_cast<std::uint32_t>(p[1]) << 8) |
         (static_cast<std::uint32_t>(p[2]) << 16) | (static_cast<std::uint32_t>(p[3]) << 24);
}

inline std::uint16_t u16(const std::uint8_t* p) {
  return static_cast<std::uint16_t>(p[0] | (p[1] << 8));
}

inline void put32(std::vector<std::uint8_t>& out, std::uint32_t value) {
  for (int i = 0; i < 4; ++i) out.push_back(static_cast<std::uint8_t>(value >> (8 * i)));
}

inline void put16(std::vector<std::uint8_t>& out, std::uint16_t value) {
  out.push_back(static_cast<std::uint8_t>(value));
  out.push_back(static_cast<std::uint8_t>(value >> 8));
}

}  // namespace detail

inline Audio decode(const std::vector<std::uint8_t>& bytes) {
  using detail::u16;
  using detail::u32;
  if (bytes.size() < 12 || std::memcmp(bytes.data(), "RIFF", 4) != 0 ||
      std::memcmp(bytes.data() + 8, "WAVE", 4) != 0) {
    throw std::runtime_error("not a RIFF/WAVE file");
  }

  int format = 0;
  int channels = 0;
  int bits = 0;
  double rate = 0.0;
  const std::uint8_t* data = nullptr;
  std::size_t dataSize = 0;

  std::size_t pos = 12;
  while (pos + 8 <= bytes.size()) {
    const std::uint8_t* chunk = bytes.data() + pos;
    const std::size_t size = u32(chunk + 4);
    const std::size_t body = pos + 8;
    if (body + size > bytes.size()) break;
    if (std::memcmp(chunk, "fmt ", 4) == 0 && size >= 16) {
      format = u16(bytes.data() + body);
      channels = u16(bytes.data() + body + 2);
      rate = static_cast<double>(u32(bytes.data() + body + 4));
      bits = u16(bytes.data() + body + 14);
      if (format == 0xfffe && size >= 26) format = u16(bytes.data() + body + 24);
    } else if (std::memcmp(chunk, "data", 4) == 0) {
      data = bytes.data() + body;
      dataSize = size;
    }
    pos = body + size + (size & 1);
  }

  if (!data || channels < 1 || channels > 2 || rate <= 0.0) {
    throw std::runtime_error("unsupported WAV layout");
  }
  const bool isFloat = format == 3 && bits == 32;
  const bool isPcm = format == 1 && (bits == 16 || bits == 24 || bits == 32);
  if (!isFloat && !isPcm) throw std::runtime_error("unsupported WAV sample format");

  const int bytesPerSample = bits / 8;
  Audio audio;
  audio.channels = channels;
  audio.sampleRate = rate;
  audio.frames = static_cast<int>(dataSize / static_cast<std::size_t>(bytesPerSample * channels));
  audio.pcm.resize(static_cast<std::size_t>(audio.frames) * channels);
  for (std::size_t i = 0; i < audio.pcm.size(); ++i) {
    const std::uint8_t* p = data + i * bytesPerSample;
    if (isFloat) {
      float value;
      std::memcpy(&value, p, 4);
      audio.pcm[i] = value;
    } else if (bits == 16) {
      audio.pcm[i] = static_cast<float>(static_cast<std::int16_t>(u16(p))) / 32768.0f;
    } else if (bits == 24) {
      std::int32_t value = p[0] | (p[1] << 8) | (p[2] << 16);
      if (value & 0x800000) value |= ~0xffffff;
      audio.pcm[i] = static_cast<float>(value) / 8388608.0f;
    } else {
      audio.pcm[i] = static_cast<float>(static_cast<std::int32_t>(u32(p))) / 2147483648.0f;
    }
  }
  return audio;
}

inline Audio readFile(const std::string& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) throw std::runtime_error("cannot open " + path);
  std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(file)),
                                  std::istreambuf_iterator<char>());
  return decode(bytes);
}

// Interleaves left/right into 16 or 24-bit PCM.
inline std::vector<std::uint8_t> encodeStereo(const std::vector<float>& left,
                                              const std::vector<float>& right,
                                              double sampleRate, int bits) {
  using detail::put16;
  using detail::put32;
  if (bits != 16 && bits != 24) throw std::runtime_error("bits must be 16 or 24");
  const int bytesPerSample = bits / 8;
  const auto frames = static_cast<std::uint32_t>(left.size());
  const std::uint32_t dataSize = frames * 2u * static_cast<std::uint32_t>(bytesPerSample);
  std::vector<std::uint8_t> out;
  out.reserve(44 + dataSize);
  out.insert(out.end(), {'R', 'I', 'F', 'F'});
  put32(out, 36 + dataSize);
  out.insert(out.end(), {'W', 'A', 'V', 'E', 'f', 'm', 't', ' '});
  put32(out, 16);
  put16(out, 1);
  put16(out, 2);
  put32(out, static_cast<std::uint32_t>(sampleRate));
  put32(out, static_cast<std::uint32_t>(sampleRate) * 2u * static_cast<std::uint32_t>(bytesPerSample));
  put16(out, static_cast<std::uint16_t>(2 * bytesPerSample));
  put16(out, static_cast<std::uint16_t>(bits));
  out.insert(out.end(), {'d', 'a', 't', 'a'});
  put32(out, dataSize);
  const double scale = bits == 16 ? 32767.0 : 8388607.0;
  for (std::uint32_t i = 0; i < frames; ++i) {
    for (const float sample : {left[i], right[i]}) {
      const double clamped = sample < -1.0f ? -1.0 : (sample > 1.0f ? 1.0 : sample);
      const auto value = static_cast<std::int32_t>(std::floor(clamped * scale + 0.5));
      for (int b = 0; b < bytesPerSample; ++b) {
        out.push_back(static_cast<std::uint8_t>(value >> (8 * b)));
      }
    }
  }
  return out;
}

inline void writeFile(const std::string& path, const std::vector<std::uint8_t>& bytes) {
  std::ofstream file(path, std::ios::binary);
  if (!file) throw std::runtime_error("cannot write " + path);
  file.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
}

}  // namespace snare::wav
