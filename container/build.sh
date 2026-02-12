#!/bin/bash
# Build the GroupGuard agent container image
# Supports both Docker and Apple Containers (macOS 26+)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"

# Detect container runtime
detect_runtime() {
  local env_runtime="${CONTAINER_RUNTIME:-auto}"

  case "$env_runtime" in
    apple)
      echo "container"
      return
      ;;
    docker)
      echo "docker"
      return
      ;;
  esac

  # Auto-detect
  if [[ "$(uname -s)" == "Darwin" ]] && command -v container &>/dev/null; then
    echo "container"
  else
    echo "docker"
  fi
}

RUNTIME=$(detect_runtime)

echo "Building GroupGuard agent container image..."
echo "Runtime: ${RUNTIME}"
echo "Image: ${IMAGE_NAME}:${TAG}"

$RUNTIME build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | ${RUNTIME} run -i ${IMAGE_NAME}:${TAG}"
