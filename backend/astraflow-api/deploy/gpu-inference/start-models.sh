#!/usr/bin/env bash
set -euo pipefail

ASR_MODEL="${ASR_MODEL:-Qwen/Qwen3-ASR-1.7B}"
TITLE_MODEL="${TITLE_MODEL:-Qwen/Qwen3-8B-AWQ}"
MODEL_ROLE="${MODEL_ROLE:-both}"
ASR_SERVED_MODEL_NAME="${ASR_SERVED_MODEL_NAME:-Qwen/Qwen3-ASR-1.7B}"
TITLE_SERVED_MODEL_NAME="${TITLE_SERVED_MODEL_NAME:-Qwen/Qwen3-8B-AWQ}"
ASR_GPU_MEMORY_UTILIZATION="${ASR_GPU_MEMORY_UTILIZATION:-0.85}"
TITLE_GPU_MEMORY_UTILIZATION="${TITLE_GPU_MEMORY_UTILIZATION:-0.85}"
ASR_MAX_NUM_SEQS="${ASR_MAX_NUM_SEQS:-4}"
TITLE_MAX_NUM_SEQS="${TITLE_MAX_NUM_SEQS:-8}"
TITLE_MAX_MODEL_LEN="${TITLE_MAX_MODEL_LEN:-8192}"

cleanup() {
  kill "${ASR_PID:-}" "${TITLE_PID:-}" 2>/dev/null || true
  wait "${ASR_PID:-}" "${TITLE_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

start_asr() {
  vllm serve "$ASR_MODEL" \
    --host 0.0.0.0 \
    --port 8001 \
    --gpu-memory-utilization "$ASR_GPU_MEMORY_UTILIZATION" \
    --max-num-seqs "$ASR_MAX_NUM_SEQS" \
    --served-model-name "$ASR_SERVED_MODEL_NAME"
}

start_title() {
  vllm serve "$TITLE_MODEL" \
    --host 0.0.0.0 \
    --port 8002 \
    --gpu-memory-utilization "$TITLE_GPU_MEMORY_UTILIZATION" \
    --max-model-len "$TITLE_MAX_MODEL_LEN" \
    --max-num-seqs "$TITLE_MAX_NUM_SEQS" \
    --served-model-name "$TITLE_SERVED_MODEL_NAME"
}

case "$MODEL_ROLE" in
  asr)
    start_asr
    ;;
  title)
    start_title
    ;;
  both)
    start_asr &
    ASR_PID=$!
    start_title &
    TITLE_PID=$!
    wait -n "$ASR_PID" "$TITLE_PID"
    ;;
  *)
    echo "MODEL_ROLE must be one of: asr, title, both" >&2
    exit 2
    ;;
esac
