# The engine built for the 606: the core with its seven voices.
boombapbot_add_machine(606 SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/voices.cpp")

if(EMSCRIPTEN)
  return()
endif()

if(SNARE_BUILD_TOOLS)
  # The core's render tool with this machine's voices in it: what the
  # WebAssembly build of the 606 is compared with.
  add_executable(boombapbot-render-606 "${BOOMBAPBOT_ENGINE_DIR}/tools/render_cli.cpp")
  target_link_libraries(boombapbot-render-606 PRIVATE boombapbot_engine_606)
  target_compile_options(boombapbot-render-606 PRIVATE ${SNARE_WARNINGS})
  set_target_properties(boombapbot-render-606 PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
endif()

if(SNARE_BUILD_TESTS)
  add_executable(test_606_voices "${CMAKE_CURRENT_SOURCE_DIR}/test_voices.cpp")
  target_include_directories(test_606_voices PRIVATE "${BOOMBAPBOT_ENGINE_DIR}/tests")
  target_link_libraries(test_606_voices PRIVATE boombapbot_engine_606)
  target_compile_options(test_606_voices PRIVATE ${SNARE_WARNINGS})
  set_target_properties(test_606_voices PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
  add_test(NAME 606.voices COMMAND test_606_voices)
endif()
