#!/usr/bin/env bash
set -euo pipefail

readonly repository="https://github.com/oomol-lab/open-connector.git"
readonly revision="1bfdc0343057303d2993bcff44d0d5821ea658fd"
readonly version="1.4.1"
readonly project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly -a patches=(
  "$project_root/deploy/open-connector-runtime-lock.patch"
  "$project_root/deploy/open-connector-gmail-attachments.patch"
)
readonly patch_id="$(node -e 'const fs=require("node:fs"),crypto=require("node:crypto"),hash=crypto.createHash("sha256");for(const path of process.argv.slice(1))hash.update(fs.readFileSync(path));console.log(hash.digest("hex").slice(0,16))' "${patches[@]}")"
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
  for patch in "${patches[@]}"; do
    if git -C "$install_root" apply --check "$patch"; then
      git -C "$install_root" apply "$patch"
    else
      git -C "$install_root" apply --reverse --check "$patch"
    fi
  done
  npm --prefix "$install_root" ci
  npm --prefix "$install_root" audit --omit=dev --audit-level=moderate
  npm --prefix "$install_root" run build
  printf '%s\n' "$patch_id" > "$install_root/.ronto-prepared"
fi
printf '%s\n' "$install_root"
