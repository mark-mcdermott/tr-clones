// boombapbot VST3 compile spike: a MIDI-triggered drum instrument on top of the
// shared render engine. No sequencer, no host sync, no custom editor.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <boombapbot/engine.h>

#include <memory>

class BoombapbotAudioProcessor final : public juce::AudioProcessor {
 public:
  BoombapbotAudioProcessor();
  ~BoombapbotAudioProcessor() override = default;

  void prepareToPlay(double sampleRate, int samplesPerBlock) override;
  void releaseResources() override;
  bool isBusesLayoutSupported(const BusesLayout& layouts) const override;

  void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override;
  using juce::AudioProcessor::processBlock;

  juce::AudioProcessorEditor* createEditor() override;
  bool hasEditor() const override;

  const juce::String getName() const override;
  bool acceptsMidi() const override;
  bool producesMidi() const override;
  bool isMidiEffect() const override;
  double getTailLengthSeconds() const override;

  int getNumPrograms() override;
  int getCurrentProgram() override;
  void setCurrentProgram(int index) override;
  const juce::String getProgramName(int index) override;
  void changeProgramName(int index, const juce::String& newName) override;

  void getStateInformation(juce::MemoryBlock& destData) override;
  void setStateInformation(const void* data, int sizeInBytes) override;

 private:
  struct EngineDeleter {
    void operator()(SnareEngine* engine) const { snare_engine_destroy(engine); }
  };

  // Synthesises the machine's sounds for `engine` and sets up its tracks and
  // mix. Control thread only, before the engine is rendered.
  void loadMachine(SnareEngine* engine);

  std::unique_ptr<SnareEngine, EngineDeleter> engine_;
  double engineSampleRate_ = 0.0;
  double tailSeconds_ = 0.0;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BoombapbotAudioProcessor)
};
