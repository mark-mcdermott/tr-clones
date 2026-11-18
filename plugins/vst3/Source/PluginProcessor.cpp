#include "PluginProcessor.h"

#include "Machine808.h"

#include <array>
#include <cstdint>

namespace {

using snare::plugin::kTracks;

// MIDI note number -> engine track, or -1 for notes no track listens to.
constexpr std::array<std::int8_t, 128> makeNoteMap() {
  std::array<std::int8_t, 128> map{};
  for (auto& entry : map) entry = -1;
  for (const snare::plugin::TrackSpec& track : kTracks) {
    map[static_cast<std::size_t>(track.gmNote)] = static_cast<std::int8_t>(track.track);
  }
  return map;
}

constexpr std::array<std::int8_t, 128> kNoteToTrack = makeNoteMap();

const juce::Identifier kStateType{"BoombapbotPluginState"};
const juce::Identifier kStateSchemaVersion{"schemaVersion"};
const juce::Identifier kStateMachine{"machine"};
constexpr const char* kMachineId = "808";
// Version 1 named a sample kit. There is nothing in it to recall now that the
// sounds are synthesised, so it loads as the defaults.
constexpr int kCurrentStateSchemaVersion = 2;

}  // namespace

BoombapbotAudioProcessor::BoombapbotAudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}

// ---- Lifecycle (off the audio thread) ---------------------------------------

void BoombapbotAudioProcessor::prepareToPlay(double sampleRate, int /*samplesPerBlock*/) {
  // The engine is tied to one sample rate. Hosts do not call prepareToPlay
  // while processBlock is running, so replacing it here is safe.
  if (engine_ != nullptr && juce::exactlyEqual(engineSampleRate_, sampleRate)) return;

  // snare_engine_create returns null outside 8 kHz..192 kHz. The plugin then
  // stays silent rather than failing.
  engine_.reset(snare_engine_create(sampleRate));
  engineSampleRate_ = sampleRate;
  if (engine_ != nullptr) loadMachine(engine_.get());
}

void BoombapbotAudioProcessor::releaseResources() {
  // The engine is kept so a later prepareToPlay at the same rate is free.
}

// The sounds are synthesised here, at the host's rate, so nothing is read from
// disk and nothing is resampled. These calls queue engine commands from the
// control thread; that is safe because the engine is new and processBlock does
// not run during prepareToPlay.
void BoombapbotAudioProcessor::loadMachine(SnareEngine* engine) {
  using namespace snare::plugin;
  double longestSeconds = 0.0;

  for (const TrackSpec& track : kTracks) {
    const SnareSoundParams sound{track.sound, kKnobCentre, kKnobCentre, kKnobCentre, kKnobCentre, 0};
    int result = snare_engine_synth_sound(engine, &sound);
    jassert(result == SNARE_OK);
    result = snare_engine_set_track(engine, track.track, track.sound, track.pan, track.chokeGroup);
    jassert(result == SNARE_OK);
    result = snare_engine_set_track_level(engine, track.track, static_cast<double>(track.trim));
    jassert(result == SNARE_OK);
    juce::ignoreUnused(result);
    longestSeconds = juce::jmax(longestSeconds, snare_synth_frames(&sound, engineSampleRate_) / engineSampleRate_);
  }
  snare_engine_set_accent(engine, kPlainGain, kAccentGain);
  snare_engine_set_master_volume(engine, kMasterVolume);
  tailSeconds_ = longestSeconds;
}

bool BoombapbotAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
  return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo() &&
         layouts.getMainInputChannelSet().isDisabled();
}

// ---- Audio thread -----------------------------------------------------------

void BoombapbotAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer,
                                          juce::MidiBuffer& midi) {
  juce::ScopedNoDenormals noDenormals;

  const int frames = buffer.getNumSamples();
  const int channels = buffer.getNumChannels();
  SnareEngine* const engine = engine_.get();

  if (engine == nullptr || channels < 2) {
    buffer.clear();
    midi.clear();
    return;
  }

  float* const left = buffer.getWritePointer(0);
  float* const right = buffer.getWritePointer(1);

  // "MIDI Trigger": every note-on plays one hit. The engine applies queued
  // triggers at the start of the next render call, so the block is split at
  // each note's sample offset: render up to the offset, queue the trigger,
  // carry on. Once prepareToPlay has returned, the audio thread is the only
  // caller that queues engine commands, which keeps the engine's command
  // queue single-producer.
  //
  // Events are read as raw bytes. Building a juce::MidiMessage could allocate
  // for long messages such as SysEx.
  int rendered = 0;
  for (const juce::MidiMessageMetadata event : midi) {
    if (event.numBytes != 3 || (event.data[0] & 0xf0) != 0x90) continue;
    const int velocity = event.data[2] & 0x7f;
    if (velocity == 0) continue;  // note-on with velocity 0 is a note-off
    const int track = kNoteToTrack[static_cast<std::size_t>(event.data[1] & 0x7f)];
    if (track < 0) continue;

    const int offset = juce::jlimit(rendered, frames, event.samplePosition);
    if (offset > rendered) {
      snare_engine_render(engine, left + rendered, right + rendered, offset - rendered);
      rendered = offset;
    }
    // A full queue drops the hit; there is nothing useful to do about it here.
    snare_engine_trigger(engine, track, velocity >= snare::plugin::kAccentVelocity ? 1 : 0);
  }

  if (frames > rendered) {
    snare_engine_render(engine, left + rendered, right + rendered, frames - rendered);
  }

  for (int channel = 2; channel < channels; ++channel) buffer.clear(channel, 0, frames);
  midi.clear();  // the plugin produces no MIDI
}

// ---- Editor -----------------------------------------------------------------

// No editor in the spike. There are no parameters for a generic editor to
// show, and this way no window is ever opened inside the host.
bool BoombapbotAudioProcessor::hasEditor() const { return false; }
juce::AudioProcessorEditor* BoombapbotAudioProcessor::createEditor() { return nullptr; }

// ---- Description ------------------------------------------------------------

const juce::String BoombapbotAudioProcessor::getName() const { return JucePlugin_Name; }
bool BoombapbotAudioProcessor::acceptsMidi() const { return true; }
bool BoombapbotAudioProcessor::producesMidi() const { return false; }
bool BoombapbotAudioProcessor::isMidiEffect() const { return false; }
double BoombapbotAudioProcessor::getTailLengthSeconds() const { return tailSeconds_; }

int BoombapbotAudioProcessor::getNumPrograms() { return 1; }
int BoombapbotAudioProcessor::getCurrentProgram() { return 0; }
void BoombapbotAudioProcessor::setCurrentProgram(int /*index*/) {}
const juce::String BoombapbotAudioProcessor::getProgramName(int /*index*/) { return {}; }
void BoombapbotAudioProcessor::changeProgramName(int /*index*/, const juce::String& /*newName*/) {}

// ---- State ------------------------------------------------------------------

// A small versioned blob: the schema version and the machine. The plugin has
// no parameters yet, so there is nothing else to recall.
void BoombapbotAudioProcessor::getStateInformation(juce::MemoryBlock& destData) {
  juce::ValueTree state(kStateType);
  state.setProperty(kStateSchemaVersion, kCurrentStateSchemaVersion, nullptr);
  state.setProperty(kStateMachine, kMachineId, nullptr);
  if (const std::unique_ptr<juce::XmlElement> xml = state.createXml()) {
    copyXmlToBinary(*xml, destData);
  }
}

// Nothing in a saved state changes how the plugin sounds yet, so whatever a
// host hands back (ours, an older one, or something else entirely) is left
// unread rather than guessed at.
void BoombapbotAudioProcessor::setStateInformation(const void* /*data*/, int /*sizeInBytes*/) {}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new BoombapbotAudioProcessor(); }
