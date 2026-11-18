# The engine built for the 808: the core with the 808's voices.
boombapbot_add_machine(808 SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/voices.cpp")

if(EMSCRIPTEN)
  return()
endif()

get_filename_component(MACHINE_808_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
# Where the 808's data files and fixtures are, for the tests that read them.
set(SNARE_PATH_DEFINITIONS SNARE_MACHINE_DIR="${MACHINE_808_DIR}")

# The engine's tool and test suites are still written against the 808's
# project and track table, so they are built here, with the 808.
if(SNARE_BUILD_TOOLS)
  add_executable(boombapbot-render-808 "${BOOMBAPBOT_ENGINE_DIR}/tools/render_cli.cpp")
  target_link_libraries(boombapbot-render-808 PRIVATE boombapbot_engine_808)
  target_compile_options(boombapbot-render-808 PRIVATE ${SNARE_WARNINGS})
  set_target_properties(boombapbot-render-808 PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
endif()

if(SNARE_BUILD_TESTS)
  foreach(suite timeline scheduler pattern_bank sequencer accent voices choke midi sound_map realtime synth swing fx)
    add_executable(test_${suite} "${BOOMBAPBOT_ENGINE_DIR}/tests/test_${suite}.cpp")
    target_link_libraries(test_${suite} PRIVATE boombapbot_engine_808)
    target_compile_options(test_${suite} PRIVATE ${SNARE_WARNINGS})
    target_compile_definitions(test_${suite} PRIVATE ${SNARE_PATH_DEFINITIONS})
    set_target_properties(test_${suite} PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
    add_test(NAME engine.${suite} COMMAND test_${suite})
  endforeach()

  # Compiled as C, to prove engine.h is a C header and pin its struct layouts.
  add_executable(test_abi "${BOOMBAPBOT_ENGINE_DIR}/tests/test_abi.c")
  set_target_properties(test_abi PROPERTIES
    C_STANDARD 11 C_STANDARD_REQUIRED ON LINKER_LANGUAGE CXX RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
  target_link_libraries(test_abi PRIVATE boombapbot_engine_808)
  target_compile_options(test_abi PRIVATE ${SNARE_WARNINGS})
  add_test(NAME engine.abi COMMAND test_abi)
endif()
