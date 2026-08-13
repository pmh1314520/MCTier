cmake_minimum_required(VERSION 3.22.1)
project(mctier_localvqe_jni LANGUAGES CXX)

set(LOCALVQE_LIB "${CMAKE_CURRENT_LIST_DIR}/../jniLibs/${ANDROID_ABI}/liblocalvqe.so")
if(NOT EXISTS "${LOCALVQE_LIB}")
    message(FATAL_ERROR "LocalVQE binary is missing for ${ANDROID_ABI}: ${LOCALVQE_LIB}")
endif()

add_library(localvqe SHARED IMPORTED)
set_target_properties(localvqe PROPERTIES IMPORTED_LOCATION "${LOCALVQE_LIB}")

add_library(localvqe_jni SHARED LocalVqeNative.cpp)
target_include_directories(localvqe_jni PRIVATE "${CMAKE_CURRENT_LIST_DIR}/include")
target_link_libraries(localvqe_jni localvqe log)
