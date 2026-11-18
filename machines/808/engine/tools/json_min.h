// Minimal JSON reader for the engine's tools and tests. It reads the shared
// contract files (roles, kit manifests, project fixtures) so those stay the
// single source of truth. Not part of the render core.
#pragma once

#include <cstdlib>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace snare::json {

struct Value {
  enum class Type { Null, Bool, Number, String, Array, Object };
  Type type = Type::Null;
  bool boolean = false;
  double number = 0.0;
  std::string string;
  std::vector<Value> array;
  // Object members, in file order: keys[i] names values[i]. Kept as two
  // vectors because a vector of pairs of this still-incomplete type is not
  // portable.
  std::vector<std::string> keys;
  std::vector<Value> values;

  bool has(const std::string& key) const {
    for (const auto& candidate : keys) {
      if (candidate == key) return true;
    }
    return false;
  }

  const Value& at(const std::string& key) const {
    for (std::size_t i = 0; i < keys.size(); ++i) {
      if (keys[i] == key) return values[i];
    }
    throw std::runtime_error("missing JSON key: " + key);
  }

  const Value& at(std::size_t index) const { return array.at(index); }
  int asInt() const { return static_cast<int>(number); }
};

class Parser {
 public:
  explicit Parser(const std::string& text) : text_(text) {}

  Value parse() {
    Value value = parseValue();
    skipSpace();
    if (pos_ != text_.size()) fail("unexpected trailing content");
    return value;
  }

 private:
  [[noreturn]] void fail(const std::string& message) const {
    throw std::runtime_error("JSON error at offset " + std::to_string(pos_) + ": " + message);
  }

  void skipSpace() {
    while (pos_ < text_.size() &&
           (text_[pos_] == ' ' || text_[pos_] == '\n' || text_[pos_] == '\r' || text_[pos_] == '\t')) {
      ++pos_;
    }
  }

  char peek() {
    skipSpace();
    if (pos_ >= text_.size()) fail("unexpected end of input");
    return text_[pos_];
  }

  void expect(char c) {
    if (peek() != c) fail(std::string("expected '") + c + "'");
    ++pos_;
  }

  bool consume(const char* literal) {
    const std::string word(literal);
    if (text_.compare(pos_, word.size(), word) == 0) {
      pos_ += word.size();
      return true;
    }
    return false;
  }

  Value parseValue() {
    const char c = peek();
    Value value;
    if (c == '{') {
      value.type = Value::Type::Object;
      ++pos_;
      if (peek() == '}') {
        ++pos_;
        return value;
      }
      for (;;) {
        std::string key = parseString();
        expect(':');
        value.keys.push_back(std::move(key));
        value.values.push_back(parseValue());
        if (peek() == ',') {
          ++pos_;
          continue;
        }
        expect('}');
        return value;
      }
    }
    if (c == '[') {
      value.type = Value::Type::Array;
      ++pos_;
      if (peek() == ']') {
        ++pos_;
        return value;
      }
      for (;;) {
        value.array.push_back(parseValue());
        if (peek() == ',') {
          ++pos_;
          continue;
        }
        expect(']');
        return value;
      }
    }
    if (c == '"') {
      value.type = Value::Type::String;
      value.string = parseString();
      return value;
    }
    if (consume("true")) {
      value.type = Value::Type::Bool;
      value.boolean = true;
      return value;
    }
    if (consume("false")) {
      value.type = Value::Type::Bool;
      return value;
    }
    if (consume("null")) return value;

    const char* start = text_.c_str() + pos_;
    char* end = nullptr;
    value.number = std::strtod(start, &end);
    if (end == start) fail("unexpected character");
    value.type = Value::Type::Number;
    pos_ += static_cast<std::size_t>(end - start);
    return value;
  }

  std::string parseString() {
    expect('"');
    std::string out;
    while (pos_ < text_.size()) {
      const char c = text_[pos_++];
      if (c == '"') return out;
      if (c != '\\') {
        out.push_back(c);
        continue;
      }
      if (pos_ >= text_.size()) break;
      const char escaped = text_[pos_++];
      switch (escaped) {
        case 'n': out.push_back('\n'); break;
        case 't': out.push_back('\t'); break;
        case 'r': out.push_back('\r'); break;
        case 'b': out.push_back('\b'); break;
        case 'f': out.push_back('\f'); break;
        case 'u':
          // The contract files are ASCII; keep the escape rather than decode.
          out.append("\\u");
          break;
        default: out.push_back(escaped); break;
      }
    }
    fail("unterminated string");
  }

  const std::string& text_;
  std::size_t pos_ = 0;
};

inline Value parse(const std::string& text) { return Parser(text).parse(); }

inline Value parseFile(const std::string& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) throw std::runtime_error("cannot open " + path);
  std::ostringstream buffer;
  buffer << file.rdbuf();
  const std::string text = buffer.str();
  return parse(text);
}

}  // namespace snare::json
