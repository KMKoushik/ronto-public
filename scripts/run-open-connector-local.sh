#!/usr/bin/env bash
set -euo pipefail

readonly version="1.4.1"
readonly project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly patch_id="$(node -e 'const fs=require("node:fs"),crypto=require("node:crypto");console.log(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex").slice(0,16))' "$project_root/deploy/open-connector-runtime-lock.patch")"
readonly install_root="${OPEN_CONNECTOR_INSTALL_PATH:-$project_root/data/open-connector-$version-$patch_id}"
readonly source_path="$install_root/source"
# Release qualification must not move an existing developer's credentials/data.
readonly runtime_path="${OPEN_CONNECTOR_DATA_PATH:-${OPEN_CONNECTOR_INSTALL_PATH:-$project_root/data/open-connector-$version}/runtime}"

: "${OPEN_CONNECTOR_ADMIN_TOKEN:?Set OPEN_CONNECTOR_ADMIN_TOKEN}"
: "${OPEN_CONNECTOR_SIDECAR_ENCRYPTION_KEY:?Set OPEN_CONNECTOR_SIDECAR_ENCRYPTION_KEY}"
: "${OPEN_CONNECTOR_ALLOWED_CUSTOM_OAUTH:?Set OPEN_CONNECTOR_ALLOWED_CUSTOM_OAUTH}"

mkdir -p "$install_root" "$runtime_path"
OPEN_CONNECTOR_INSTALL_PATH="$source_path" bash "$project_root/scripts/prepare-open-connector.sh"

export HOST="127.0.0.1"
export PORT="${OPEN_CONNECTOR_PORT:-3199}"
export OOMOL_CONNECT_ORIGIN="${WEB_URL:-http://localhost:2718}"
export OOMOL_CONNECT_DATA_DIR="$runtime_path"
export OOMOL_CONNECT_ADMIN_TOKEN="$OPEN_CONNECTOR_ADMIN_TOKEN"
export OOMOL_CONNECT_ENCRYPTION_KEY="$OPEN_CONNECTOR_SIDECAR_ENCRYPTION_KEY"
export OOMOL_CONNECT_ALLOWED_ACTIONS="gmail.*,googlecalendar.*"
export OOMOL_CONNECT_ALLOWED_CUSTOM_OAUTH="$OPEN_CONNECTOR_ALLOWED_CUSTOM_OAUTH"
export OOMOL_CONNECT_ALLOWED_PROXIES=""
export OOMOL_CONNECT_BLOCKED_PROXIES="*"

exec npm --prefix "$source_path" start
