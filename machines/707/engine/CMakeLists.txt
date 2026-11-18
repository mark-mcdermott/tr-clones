# The engine built for the 707: the core with its fifteen voices.
boombapbot_add_machine(707 SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/voices.cpp")

if(EMSCRIPTEN)
  return()
endif()

if(SNARE_BUILD_TOOLS)
  # The core's render tool with this machine's voices in it: what the
  # WebAssembly build of the 707 is compared with.
  add_executable(boombapbot-render-707 "${BOOMBAPBOT_ENGINE_DIR}/tools/render_cli.cpp")
  target_link_libraries(boombapbot-render-707 PRIVATE boombapbot_engine_707)
  target_compile_options(boombapbot-render-707 PRIVATE ${SNARE_WARNINGS})
  set_target_properties(boombapbot-render-707 PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
endif()

if(SNARE_BUILD_TESTS)
  add_executable(test_707_voices "${CMAKE_CURRENT_SOURCE_DIR}/test_voices.cpp")
  target_include_directories(test_707_voices PRIVATE "${BOOMBAPBOT_ENGINE_DIR}/tests")
  target_link_libraries(test_707_voices PRIVATE boombapbot_engine_707)
  target_compile_options(test_707_voices PRIVATE ${SNARE_WARNINGS})
  set_target_properties(test_707_voices PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
  add_test(NAME 707.voices COMMAND test_707_voices)
endif()
