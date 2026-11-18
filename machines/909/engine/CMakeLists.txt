# The engine built for the 909: the core with its eleven voices.
boombapbot_add_machine(909 SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/voices.cpp")

if(EMSCRIPTEN)
  return()
endif()

if(SNARE_BUILD_TOOLS)
  # The core's render tool with this machine's voices in it: what the
  # WebAssembly build of the 909 is compared with.
  add_executable(boombapbot-render-909 "${BOOMBAPBOT_ENGINE_DIR}/tools/render_cli.cpp")
  target_link_libraries(boombapbot-render-909 PRIVATE boombapbot_engine_909)
  target_compile_options(boombapbot-render-909 PRIVATE ${SNARE_WARNINGS})
  set_target_properties(boombapbot-render-909 PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
endif()

if(SNARE_BUILD_TESTS)
  add_executable(test_909_voices "${CMAKE_CURRENT_SOURCE_DIR}/test_voices.cpp")
  target_include_directories(test_909_voices PRIVATE "${BOOMBAPBOT_ENGINE_DIR}/tests")
  target_link_libraries(test_909_voices PRIVATE boombapbot_engine_909)
  target_compile_options(test_909_voices PRIVATE ${SNARE_WARNINGS})
  set_target_properties(test_909_voices PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
  add_test(NAME 909.voices COMMAND test_909_voices)
endif()
