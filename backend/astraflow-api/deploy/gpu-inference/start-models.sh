#!/usr/bin/env bash
set -euo pipefail

ASR_MODEL="${ASR_MODEL:-Qwen/Qwen3-ASR-1.7B}"
TITLE_MODEL="${TITLE_MODEL:-Qwen/Qwen3-8B-AWQ}"
ASR_GPU_MEMORY_UTILIZATION="${ASR_GPU_MEMORY_UTILIZATION:-0.28}"
TITLE_GPU_MEMORY_UTILIZATION="${TITLE_GPU_MEMORY_UTILIZATION:-0.55}"
TITLE_MAX_MODEL_LEN="${TITLE_MAX_MODEL_LEN:-8192}"

cleanup() {
  kill "${ASR_PID:-}" "${TITLE_PID:-}" 2>/dev/null || true
  wait "${ASR_PID:-}" "${TITLE_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

vllm serve "$ASR_MODEL" \
  --host 0.0.0.0 \
  --port 8001 \
  --gpu-memory-utilization "$ASR_GPU_MEMORY_UTILIZATION" \
  --served-model-name "$ASR_MODEL" &
ASR_PID=$!

vllm serve "$TITLE_MODEL" \
  --host 0.0.0.0 \
  --port 8002 \
  --gpu-memory-utilization "$TITLE_GPU_MEMORY_UTILIZATION" \
  --max-model-len "$TITLE_MAX_MODEL_LEN" \
  --max-num-seqs 8 \
  --served-model-name "$TITLE_MODEL" &
TITLE_PID=$!

wait -n "$ASR_PID" "$TITLE_PID"
