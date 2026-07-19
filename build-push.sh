#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# build-push.sh — build and push the bid-ai-processor container image
# Usage: ./build-push.sh [OPTIONS]
#   -u  Docker registry username
#   -p  Docker registry password
#   -r  Repository name  (e.g. <username>/bid-ai-processor)
#   -t  Tag              (optional; auto-increments patch from latest remote tag)
# ---------------------------------------------------------------------------

REGISTRY="docker.io"
USERNAME=""
PASSWORD=""
REPO=""
TAG=""

usage() {
  echo "Usage: $0 -u <username> -p <password> -r <repo> [-t <tag>]"
  exit 1
}

while getopts "u:p:r:t:h" opt; do
  case $opt in
    u) USERNAME="$OPTARG" ;;
    p) PASSWORD="$OPTARG" ;;
    r) REPO="$OPTARG"     ;;
    t) TAG="$OPTARG"      ;;
    h) usage              ;;
    *) usage              ;;
  esac
done

# Prompt for missing required fields
if [[ -z "$USERNAME" ]]; then
  read -rp "Docker registry username: " USERNAME
fi
if [[ -z "$PASSWORD" ]]; then
  if [[ -n "${DOCKER_PASSWORD_FILE:-}" && -f "$DOCKER_PASSWORD_FILE" ]]; then
    PASSWORD=$(cat "$DOCKER_PASSWORD_FILE")
  else
    read -rsp "Docker registry password: " PASSWORD
    echo
  fi
fi
if [[ -z "$REPO" ]]; then
  DEFAULT_REPO="${USERNAME}/bid-ai-processor"
  read -rp "Repository name [${DEFAULT_REPO}]: " REPO
  REPO="${REPO:-$DEFAULT_REPO}"
fi

# ---------------------------------------------------------------------------
# Login first (validates credentials early; also needed before resolve_tag)
# ---------------------------------------------------------------------------
echo ""
echo "Logging in to Docker Hub as ${USERNAME} ..."
echo "${PASSWORD}" | docker login -u "${USERNAME}" --password-stdin
echo "Login successful."

# ---------------------------------------------------------------------------
# Resolve tag — auto-increment patch from latest remote semver tag
# ---------------------------------------------------------------------------
resolve_tag() {
  local token tags major minor patch

  token=$(curl -s -X POST "https://hub.docker.com/v2/users/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}" \
    | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)

  if [[ -z "$token" ]]; then
    echo "0.0.0"; return
  fi

  tags=$(curl -s -H "Authorization: Bearer ${token}" \
    "https://hub.docker.com/v2/repositories/${REPO}/tags/?page_size=100" \
    | grep -o '"name":"[0-9]*\.[0-9]*\.[0-9]*"' | cut -d'"' -f4 | sort -V | tail -1 || true)

  if [[ -z "$tags" ]]; then
    echo "0.0.0"; return
  fi

  IFS='.' read -r major minor patch <<< "$tags" || true
  echo "${major}.${minor}.$((patch + 1))"
}

if [[ -z "$TAG" ]]; then
  echo "No tag supplied — resolving from registry..."
  TAG=$(resolve_tag)
  echo "Using tag: ${TAG}"
fi

# Docker Hub image names must NOT include the docker.io prefix
FULL_IMAGE="${REPO}:${TAG}"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
echo ""
echo "Building ${FULL_IMAGE} ..."
docker build -f Containerfile -t "${FULL_IMAGE}" .

# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------
echo ""
echo "Pushing ${FULL_IMAGE} ..."
docker push "${FULL_IMAGE}"

echo ""
echo "Done → ${FULL_IMAGE}"

# ---------------------------------------------------------------------------
# Git: commit any pending changes and push to the tracked upstream
# ---------------------------------------------------------------------------
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo ""
  echo "Not a git repository — skipping git push."
else
  echo ""
  echo "Pushing code to git ..."

  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "Release ${TAG}"
  else
    echo "No pending changes to commit."
  fi

  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if push_output=$(git push 2>&1); then
    echo "$push_output"
  elif echo "$push_output" | grep -q "has no upstream branch"; then
    echo "No upstream configured — pushing to origin/${BRANCH} and setting upstream..."
    git push -u origin "${BRANCH}"
  else
    echo "$push_output" >&2
    exit 1
  fi

  echo "Pushed to git."
fi
