#pragma once

#include <stdint.h>

extern "C" {
typedef uintptr_t localvqe_ctx_t;
localvqe_ctx_t localvqe_new(const char* model_path);
void localvqe_free(localvqe_ctx_t ctx);
int localvqe_process_frame_s16(localvqe_ctx_t ctx, const int16_t* mic,
                               const int16_t* ref, int hop_samples,
                               int16_t* out);
}
