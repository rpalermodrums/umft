#!/bin/sh

fail() {
  echo "[E2E][FAIL] $*" >&2
  exit 1
}

log() {
  echo "[E2E] $*"
}

assert_eq() {
  actual="$1"
  expected="$2"
  context="$3"
  if [ "$actual" != "$expected" ]; then
    fail "$context: expected '$expected', got '$actual'"
  fi
}

assert_exit_code() {
  actual="$1"
  expected="$2"
  context="$3"
  assert_eq "$actual" "$expected" "$context"
}

assert_file_exists() {
  path="$1"
  if [ ! -f "$path" ]; then
    fail "Expected file to exist: $path"
  fi
}

assert_dir_exists() {
  path="$1"
  if [ ! -d "$path" ]; then
    fail "Expected directory to exist: $path"
  fi
}

assert_file_contains() {
  path="$1"
  needle="$2"
  if ! grep -F "$needle" "$path" >/dev/null 2>&1; then
    fail "Expected '$path' to contain '$needle'"
  fi
}

assert_text_contains() {
  text="$1"
  needle="$2"
  context="$3"
  echo "$text" | grep -F "$needle" >/dev/null 2>&1 || fail "$context: missing '$needle'"
}

run_expect_exit() {
  expected="$1"
  shift
  set +e
  "$@"
  status=$?
  set -e
  assert_exit_code "$status" "$expected" "$*"
}
