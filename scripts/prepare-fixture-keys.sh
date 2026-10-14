#!/bin/sh
set -eu
fixture_dir="${FIXTURE_KEY_DIR:-tests/.fixture-key}"
mkdir -p "$fixture_dir"
chmod 700 "$fixture_dir"
if [ ! -f "$fixture_dir/key" ]; then
  ssh-keygen -q -t ed25519 -N '' -C 'disposable-workspace-fixture' -f "$fixture_dir/key"
fi
if [ ! -f "$fixture_dir/encrypted-key" ]; then
  cp "$fixture_dir/key" "$fixture_dir/encrypted-key"
  ssh-keygen -q -p -P '' -N 'fixture-key-passphrase' -f "$fixture_dir/encrypted-key"
fi
