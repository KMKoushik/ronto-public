#!/usr/bin/env bash
set -euo pipefail

readonly repository="https://github.com/oomol-lab/open-connector.git"
readonly revision="1bfdc0343057303d2993bcff44d0d5821ea658fd"
readonly version="1.4.1"
readonly project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly lock_patch="$project_root/deploy/open-connector-runtime-lock.patch"
readonly patch_id="$(node -e 'const fs=require("node:fs"),crypto=require("node:crypto");console.log(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex").slice(0,16))' "$lock_patch")"
readonly install_root="${OPEN_CONNECTOR_INSTALL_PATH:-/opt/open-connector/releases/$version-$revision-$patch_id}"

mkdir -p "$install_root"
if [[ ! -d "$install_root/.git" ]]; then
  git clone --filter=blob:none --no-checkout "$repository" "$install_root"
  git -C "$install_root" fetch --depth=1 origin "$revision"
  git -C "$install_root" checkout --detach "$revision"
fi

if [[ "$(git -C "$install_root" rev-parse HEAD)" != "$revision" ]]; then
  echo "OpenConnector checkout does not match pinned $version revision $revision" >&2
  exit 1
fi

if [[ -f "$install_root/.ronto-prepared" ]]; then
  test "$(cat "$install_root/.ronto-prepared")" = "$patch_id"
  # Prepared releases may already be active. Re-audit, never reinstall in place.
  npm --prefix "$install_root" audit --omit=dev --audit-level=moderate
else
  if git -C "$install_root" apply --check "$lock_patch"; then
    git -C "$install_root" apply "$lock_patch"
  else
    git -C "$install_root" apply --reverse --check "$lock_patch"
  fi
  npm --prefix "$install_root" ci
  npm --prefix "$install_root" audit --omit=dev --audit-level=moderate
  npm --prefix "$install_root" run build
  printf '%s\n' "$patch_id" > "$install_root/.ronto-prepared"
fi
printf '%s\n' "$install_root"
