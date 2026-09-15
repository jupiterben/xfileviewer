#!/usr/bin/env bash
# xfileviewer 一键编译安装（macOS）
if [ -z "${BASH_VERSION:-}" ]; then
  if command -v bash >/dev/null 2>&1; then
    exec bash "$0" "$@"
  fi
  echo "错误: 需要 bash，当前解释器无法运行本脚本" >&2
  exit 1
fi
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SKIP_DEPS=0
BUILD_ONLY=0
BUMP_VERSION=0
PRINT_VERSION=0
MIN_NODE_MAJOR=18
STAMPED_VERSION=""

usage() {
  cat <<'EOF'
用法: ./install_macos.sh [选项]

  检查 Xcode Command Line Tools / Node / Rust，编译 Tauri .app，再安装到 /Applications。

  --skip-deps      跳过系统依赖安装（仍检查 Node / Rust / CLT）
  --build-only     只编译，不安装
  --bump-version   升高补丁号并写入 package.json / tauri.conf.json / Cargo.toml
  --print-version  只打印将要使用的版本号
  -h, --help       显示帮助

默认沿用源码当前版本。只有加 --bump-version 才会升高补丁号（取 源码+1、git 提交数、已安装+1 的最大值）。
EOF
}

log() { printf '\n==> %s\n' "$*"; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    command -v sudo >/dev/null 2>&1 || die "需要管理员权限，请安装 sudo 或以 root 运行"
    sudo "$@"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

cpu_count() {
  sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2
}

# cargo 默认占满所有核。已设置的 CARGO_BUILD_JOBS 优先。
limit_build_jobs() {
  if [[ -n "${CARGO_BUILD_JOBS:-}" ]]; then
    log "使用已有 CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS}"
    return 0
  fi
  local n jobs
  n="$(cpu_count)"
  [[ "$n" =~ ^[0-9]+$ ]] || n=2
  if (( n <= 2 )); then
    jobs=1
  elif (( n <= 8 )); then
    jobs=$((n - 1))
  else
    jobs=$((n - 4))
  fi
  export CARGO_BUILD_JOBS="$jobs"
  log "限制编译并行: ${CARGO_BUILD_JOBS} / ${n} 核（留给桌面）"
}

run_niced() {
  if have nice; then
    nice -n 10 "$@"
  else
    "$@"
  fi
}

abs_path() {
  if have realpath; then
    realpath "$1"
  else
    python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"
  fi
}

host_triple() {
  rustc -vV 2>/dev/null | awk '/^host:/{print $2; exit}'
}

load_toolchains() {
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
  fi
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.nvm/nvm.sh"
  fi
  if have brew; then
    local brew_prefix
    brew_prefix="$(brew --prefix 2>/dev/null || true)"
    if [[ -n "${brew_prefix:-}" && -d "${brew_prefix}/bin" ]]; then
      PATH="${brew_prefix}/bin:${PATH}"
    fi
  fi
}

node_major() {
  have node || return 1
  node -p "process.versions.node.split('.')[0]"
}

ensure_xcode_clt() {
  if xcode-select -p >/dev/null 2>&1; then
    log "Xcode Command Line Tools: $(xcode-select -p)"
    return 0
  fi
  die "未安装 Xcode Command Line Tools。请先运行: xcode-select --install"
}

ensure_node() {
  load_toolchains
  local major
  major="$(node_major 2>/dev/null || true)"
  if [[ -n "${major:-}" && "$major" -ge "$MIN_NODE_MAJOR" ]]; then
    log "Node $(node -v)"
    return 0
  fi

  [[ "$SKIP_DEPS" -eq 1 ]] && die "未找到 Node.js ${MIN_NODE_MAJOR}+（--skip-deps 不会自动安装）"

  log "安装 Node.js (>= ${MIN_NODE_MAJOR})"
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.nvm/nvm.sh"
    nvm install 22
    nvm use 22
  elif have brew; then
    brew install node@22 || brew install node
    load_toolchains
  else
    die "未找到 Node.js ${MIN_NODE_MAJOR}+。请安装 Homebrew 后重试，或从 https://nodejs.org 安装 Node 22+"
  fi

  load_toolchains
  major="$(node_major 2>/dev/null || true)"
  [[ -n "${major:-}" && "$major" -ge "$MIN_NODE_MAJOR" ]] || die "Node.js 版本过低（需要 ${MIN_NODE_MAJOR}+），当前: ${major:-未安装}"
  have npm || die "未找到 npm"
  log "Node $(node -v), npm $(npm -v)"
}

ensure_rust() {
  load_toolchains
  if have rustc && have cargo; then
    log "Rust $(rustc --version)"
    return 0
  fi
  [[ "$SKIP_DEPS" -eq 1 ]] && die "未找到 Rust（--skip-deps 不会自动安装）"
  have curl || die "安装 Rust 需要 curl"
  log "安装 Rust（rustup）"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  load_toolchains
  have rustc && have cargo || die "Rust 安装失败"
  log "Rust $(rustc --version)"
}

parse_semver() {
  local v="${1%%-*}"
  v="${v%%+*}"
  local -n _major="$2" _minor="$3" _patch="$4"
  if [[ "$v" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
    _major="${BASH_REMATCH[1]}"
    _minor="${BASH_REMATCH[2]}"
    _patch="${BASH_REMATCH[3]}"
  else
    _major=0
    _minor=1
    _patch=0
  fi
}

max_n() {
  local m=0 n
  for n in "$@"; do
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    (( n > m )) && m=$n
  done
  printf '%s' "$m"
}

installed_app_version() {
  local plist="/Applications/xfileviewer.app/Contents/Info.plist"
  [[ -f "$plist" ]] || return 0
  defaults read "$plist" CFBundleShortVersionString 2>/dev/null || true
}

current_version() {
  node -p "require('./package.json').version" 2>/dev/null || echo 0.1.0
}

# 升高补丁号。仅 --bump-version 时使用。
design_version() {
  local major=0 minor=1 src_patch=0 git_patch=0 inst_patch=0
  local current installed inst_major=0 inst_minor=0
  current="$(current_version)"
  parse_semver "$current" major minor src_patch
  src_patch=$((src_patch + 1))
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git_patch="$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 0)"
  fi
  installed="$(installed_app_version)"
  if [[ -n "$installed" ]]; then
    parse_semver "$installed" inst_major inst_minor inst_patch
    inst_patch=$((inst_patch + 1))
  fi
  local patch
  patch="$(max_n "$src_patch" "$git_patch" "$inst_patch")"
  [[ "$patch" =~ ^[0-9]+$ && "$patch" -ge 1 ]] || patch="$(date -u +%Y%m%d)"
  printf '%s.%s.%s' "$major" "$minor" "$patch"
}

resolve_version() {
  if [[ "$BUMP_VERSION" -eq 1 ]]; then
    design_version
  else
    current_version
  fi
}

stamp_version() {
  local version hash=""
  version="$(resolve_version)"
  STAMPED_VERSION="$version"
  hash="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"
  if [[ "$BUMP_VERSION" -ne 1 ]]; then
    log "应用版本 ${version}${hash:+ ($hash)}（未升版本，加 --bump-version 才会升高补丁号）"
    return 0
  fi
  log "应用版本 ${version}${hash:+ ($hash)}"
  APP_VERSION="$version" node <<'EOF'
const fs = require("fs");
const version = process.env.APP_VERSION;
if (!version) {
  console.error("APP_VERSION 为空");
  process.exit(1);
}

function writeJson(file, mutate) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

writeJson("package.json", (pkg) => {
  pkg.version = version;
});

if (fs.existsSync("package-lock.json")) {
  writeJson("package-lock.json", (lock) => {
    lock.version = version;
    if (lock.packages && lock.packages[""]) lock.packages[""].version = version;
  });
}

writeJson("src-tauri/tauri.conf.json", (tauri) => {
  tauri.version = version;
});

const cargoPath = "src-tauri/Cargo.toml";
const cargo = fs.readFileSync(cargoPath, "utf8");
fs.writeFileSync(
  cargoPath,
  cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`),
);
EOF
}

macos_bundle_dirs() {
  local host
  host="$(host_triple)"
  printf '%s\n' "src-tauri/target/release/bundle/macos"
  if [[ -n "${host:-}" ]]; then
    printf '%s\n' "src-tauri/target/${host}/release/bundle/macos"
  fi
}

clean_stale_bundles() {
  local dir
  while IFS= read -r dir; do
    [[ -d "$dir" ]] || continue
    log "清理旧打包产物: $dir"
    rm -rf "$dir/xfileviewer.app"
  done < <(macos_bundle_dirs)
}

find_built_app() {
  local dir app leftover=""
  while IFS= read -r dir; do
    app="${dir}/xfileviewer.app"
    if [[ -d "$app" ]]; then
      printf '%s' "$app"
      return 0
    fi
    leftover="${leftover:+$leftover }${dir}"
  done < <(macos_bundle_dirs)
  die "未找到 xfileviewer.app（已检查: ${leftover:-无}）"
}

quit_running_app() {
  if ! pgrep -x xfileviewer >/dev/null 2>&1; then
    return 0
  fi
  log "关闭正在运行的 xfileviewer"
  osascript -e 'tell application "xfileviewer" to quit' >/dev/null 2>&1 || true
  local i
  for i in 1 2 3 4 5; do
    pgrep -x xfileviewer >/dev/null 2>&1 || return 0
    sleep 1
  done
  pkill -x xfileviewer >/dev/null 2>&1 || true
  sleep 1
  if pgrep -x xfileviewer >/dev/null 2>&1; then
    die "无法结束正在运行的 xfileviewer，请先手动退出后再安装"
  fi
}

build_app() {
  log "安装 npm 依赖"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi

  clean_stale_bundles
  limit_build_jobs
  log "编译 xfileviewer（macOS .app）"
  run_niced npm run tauri -- build --bundles app
}

install_app() {
  [[ "$BUILD_ONLY" -eq 1 ]] && { log "已跳过安装（--build-only）"; return 0; }

  local version="${STAMPED_VERSION:-}"
  [[ -n "$version" ]] || version="$(resolve_version)"

  local src dest="/Applications/xfileviewer.app"
  src="$(abs_path "$(find_built_app)")"
  log "安装 ${src} → ${dest}（戳记版本 ${version}）"

  quit_running_app

  if [[ -e "$dest" ]]; then
    if [[ -w "$dest" || -w /Applications ]]; then
      rm -rf "$dest"
    else
      run_root rm -rf "$dest"
    fi
  fi

  if [[ -w /Applications ]]; then
    ditto "$src" "$dest"
  else
    run_root ditto "$src" "$dest"
  fi

  xattr -dr com.apple.quarantine "$dest" >/dev/null 2>&1 || true

  # Refresh document types even when reinstalling the same application version.
  local lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  if [[ -x "$lsregister" ]]; then
    "$lsregister" -f "$dest" || die "注册 macOS 文件类型失败"
  fi

  local installed
  installed="$(installed_app_version)"
  [[ -n "$installed" ]] && log "已安装版本 ${installed}"
  log "安装完成。可打开: open -a xfileviewer -- /path/to/file"
}

for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=1 ;;
    --build-only|--no-install) BUILD_ONLY=1 ;;
    --bump-version) BUMP_VERSION=1 ;;
    --print-version) PRINT_VERSION=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $arg（使用 -h 查看帮助）" ;;
  esac
done

if [[ "$PRINT_VERSION" -eq 1 ]]; then
  resolve_version
  printf '\n'
  exit 0
fi

[[ "$(uname -s)" == Darwin ]] || die "当前脚本仅支持 macOS"

ensure_xcode_clt
ensure_node
ensure_rust
stamp_version
build_app
install_app
