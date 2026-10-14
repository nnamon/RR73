#!/bin/sh
# Prints the key of the Rust dependency caches: a hash of Cargo.lock without the workspace's own
# versions, which every release changes, and of rust-toolchain.toml. A release keeps the key; a
# change of dependency or toolchain gives a new one.
set -eu
{ sed '/^name = "rr73-/{n;/^version = /d;}' Cargo.lock; cat rust-toolchain.toml; } | sha256sum | cut -c1-16
