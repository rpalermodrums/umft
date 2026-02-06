variable "RUNTIME_TAG" {
  default = "umft:runtime-local"
}

variable "E2E_TAG" {
  default = "umft:e2e"
}

target "_base" {
  context    = "."
  dockerfile = "Dockerfile"
}

target "runtime-local" {
  inherits = ["_base"]
  target   = "runtime"
  tags     = ["${RUNTIME_TAG}"]
  output   = ["type=docker"]
}

target "e2e-image" {
  inherits = ["_base"]
  target   = "e2e"
  tags     = ["${E2E_TAG}"]
  output   = ["type=docker"]
}

target "test-image" {
  inherits = ["_base"]
  target   = "test"
  tags     = ["umft:test"]
  output   = ["type=docker"]
}

target "runtime-multiarch" {
  inherits  = ["_base"]
  target    = "runtime"
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["umft:runtime-multiarch"]
  output    = ["type=cacheonly"]
}

group "default" {
  targets = ["runtime-local"]
}

group "ci-smoke" {
  targets = ["runtime-local", "e2e-image"]
}

group "ci-nightly" {
  targets = ["e2e-image", "runtime-multiarch"]
}
