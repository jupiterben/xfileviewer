#!/usr/bin/env bash
# xfileviewer 一键编译安装（Linux）
# `sh install_linux.sh` 会走 dash，必须先转交 bash
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
用法: ./install_linux.sh [选项]

  检查并安装系统依赖 / Node / Rust，编译 Tauri 应用，再安装到系统。

  --skip-deps      跳过系统依赖安装（仍检查 Node / Rust）
  --build-only     只编译，不安装
  --bump-version   升高补丁号并写入 package.json / tauri.conf.json / Cargo.toml
  --print-version  只打印将要使用的版本号
  -h, --help       显示帮助

默认沿用源码当前版本（同版本会 apt --reinstall）。只有加 --bump-version 才会升高补丁号（取 源码+1、git 提交数、已安装+1 的最大值）。
EOF
}

log() { printf '\n==> %s\n' "$*"; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    command -v sudo >/dev/null 2>&1 || die "需要 root 权限，请安装 sudo 或以 root 运行"
    sudo "$@"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

# cargo 默认 jobs=nproc，会饿死 GNOME Wayland 合成器。已设置的 CARGO_BUILD_JOBS 优先。
limit_build_jobs() {
  if [[ -n "${CARGO_BUILD_JOBS:-}" ]]; then
    log "使用已有 CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS}"
    return 0
  fi
  local n jobs
  n="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
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
  if have ionice; then
    nice -n 10 ionice -c 2 -n 7 "$@"
  elif have nice; then
    nice -n 10 "$@"
  else
    "$@"
  fi
}

abs_path() {
  if have realpath; then
    realpath "$1"
  else
    readlink -f "$1"
  fi
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
}

node_major() {
  have node || return 1
  node -p "process.versions.node.split('.')[0]"
}

ensure_node() {
  load_toolchains
  local major
  major="$(node_major 2>/dev/null || true)"
  if [[ -n "${major:-}" && "$major" -ge "$MIN_NODE_MAJOR" ]]; then
    log "Node $(node -v)"
    return 0
  fi

  log "安装 Node.js (>= ${MIN_NODE_MAJOR})"
  case "$PM" in
    apt)
      if have curl; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | run_root bash -
        run_root apt-get install -y nodejs
      else
        run_root apt-get install -y nodejs npm
      fi
      ;;
    dnf)
      run_root dnf install -y nodejs npm
      ;;
    pacman)
      run_root pacman -S --needed --noconfirm nodejs npm
      ;;
    zypper)
      run_root zypper --non-interactive install nodejs22 npm || run_root zypper --non-interactive install nodejs npm
      ;;
    *)
      die "未找到 Node.js ${MIN_NODE_MAJOR}+，请先安装后重试"
      ;;
  esac

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
  have curl || die "安装 Rust 需要 curl"
  log "安装 Rust（rustup）"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  load_toolchains
  have rustc && have cargo || die "Rust 安装失败"
  log "Rust $(rustc --version)"
}

detect_pm() {
  if have apt-get; then
    PM=apt
  elif have dnf; then
    PM=dnf
  elif have pacman; then
    PM=pacman
  elif have zypper; then
    PM=zypper
  else
    PM=unknown
  fi
}

install_system_deps() {
  [[ "$SKIP_DEPS" -eq 1 ]] && { log "跳过系统依赖安装"; return 0; }
  log "安装系统编译依赖（$PM）"
  case "$PM" in
    apt)
      run_root apt-get update
      run_root apt-get install -y \
        libwebkit2gtk-4.1-dev \
        build-essential \
        curl \
        wget \
        file \
        libxdo-dev \
        libssl-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        patchelf
      ;;
    dnf)
      run_root dnf install -y \
        webkit2gtk4.1-devel \
        openssl-devel \
        curl \
        wget \
        file \
        libappindicator-gtk3-devel \
        librsvg2-devel \
        libxdo-devel \
        gcc \
        gcc-c++ \
        make \
        patchelf
      run_root dnf group install -y c-development 2>/dev/null || true
      ;;
    pacman)
      run_root pacman -Sy --needed --noconfirm \
        webkit2gtk-4.1 \
        base-devel \
        curl \
        wget \
        file \
        openssl \
        appmenu-gtk-module \
        libappindicator-gtk3 \
        librsvg \
        xdotool \
        patchelf
      ;;
    zypper)
      run_root zypper --non-interactive install -t pattern devel_basis || true
      run_root zypper --non-interactive install \
        webkit2gtk-4_1-devel \
        libopenssl-devel \
        curl \
        wget \
        file \
        libappindicator3-devel \
        librsvg-devel \
        gcc \
        gcc-c++ \
        make \
        patchelf
      ;;
    *)
      die "无法识别包管理器。请先按 Tauri 文档装好依赖，再运行: ./install_linux.sh --skip-deps"
      ;;
  esac
}

# 解析 X.Y.Z（忽略 -rev / +meta），写入 nameref。
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
  local v=""
  if have dpkg-query; then
    v="$(dpkg-query -W -f '${Version}' xfileviewer 2>/dev/null || true)"
    [[ -n "$v" ]] && { printf '%s' "$v"; return 0; }
  fi
  if have rpm; then
    v="$(rpm -q --qf '%{VERSION}' xfileviewer 2>/dev/null || true)"
    [[ -n "$v" && "$v" != *"not installed"* ]] && { printf '%s' "$v"; return 0; }
  fi
  return 0
}

current_version() {
  node -p "require('./package.json').version" 2>/dev/null || echo 0.1.0
}

# 升高补丁号，避免 apt 认为「已是最新」。仅 --bump-version 时使用。
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

# 避免上次构建的旧包被 glob 误选（真正安装仍按戳记版本匹配）。
clean_stale_bundles() {
  local dir
  for dir in src-tauri/target/release/bundle/deb src-tauri/target/release/bundle/rpm; do
    [[ -d "$dir" ]] || continue
    log "清理旧打包产物: $dir"
    find "$dir" -maxdepth 1 \( -name '*.deb' -o -name '*.rpm' \) -delete
  done
}

# 选出文件名包含戳记版本的包；找不到则列出目录内容并退出。
pick_stamped_bundle() {
  local dir="$1" ext="$2" version="$3"
  local -a matches leftover
  [[ -n "$version" ]] || die "内部错误: 未设置戳记版本，无法选择 .${ext}"
  shopt -s nullglob
  matches=("$dir"/*_"${version}"_*."$ext")
  if [[ ${#matches[@]} -eq 0 ]]; then
    matches=("$dir"/*-"${version}"-*."$ext")
  fi
  leftover=("$dir"/*."$ext")
  shopt -u nullglob
  if [[ ${#matches[@]} -eq 0 ]]; then
    die "未找到版本 ${version} 的 .${ext}（目录 ${dir} 现有: ${leftover[*]:-无}）"
  fi
  local newest="" f
  for f in "${matches[@]}"; do
    if [[ -z "$newest" || "$f" -nt "$newest" ]]; then
      newest="$f"
    fi
  done
  printf '%s' "$newest"
}

installed_deb_version() {
  dpkg-query -W -f '${Version}' xfileviewer 2>/dev/null || true
}

# 家目录通常 700，apt 的 _apt 用户读不到本地 .deb，会打 unsandboxed Notice。
# 拷到 /tmp 并放宽权限后，sandbox 能读，提示消失。
stage_deb_for_apt() {
  local src="$1" staged
  staged="$(mktemp -d /tmp/xfileviewer-deb.XXXXXX)"
  chmod 755 "$staged"
  cp -a "$src" "$staged/"
  chmod 644 "$staged/$(basename "$src")"
  printf '%s\t%s' "$staged" "$staged/$(basename "$src")"
}

install_deb() {
  local pkg version installed staged_dir="" staged_pkg=""
  pkg="$(abs_path "$1")"
  version="$2"
  installed="$(installed_deb_version)"
  log "安装 ${pkg}（戳记版本 ${version}）"
  IFS=$'\t' read -r staged_dir staged_pkg <<<"$(stage_deb_for_apt "$pkg")"
  pkg="$staged_pkg"
  if [[ -n "$installed" && "$installed" == "$version" ]]; then
    log "已安装同版本 ${installed}，执行 --reinstall"
    run_root apt-get install --reinstall -y "$pkg" || {
      run_root dpkg -i "$pkg"
      run_root apt-get install -f -y
    }
  else
    run_root apt-get install -y "$pkg" || {
      run_root dpkg -i "$pkg"
      run_root apt-get install -f -y
    }
  fi
  rm -rf -- "$staged_dir"
}

build_app() {
  log "安装 npm 依赖"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi

  local -a extra=(--ci)
  case "$PM" in
    apt) extra+=(--bundles deb) ;;
    dnf|zypper) extra+=(--bundles rpm) ;;
    *) extra+=(--no-bundle) ;;
  esac

  clean_stale_bundles
  limit_build_jobs
  log "编译 xfileviewer"
  run_niced npm run tauri build -- "${extra[@]}"
}

install_app() {
  [[ "$BUILD_ONLY" -eq 1 ]] && { log "已跳过安装（--build-only）"; return 0; }

  local version="${STAMPED_VERSION:-}"
  [[ -n "$version" ]] || version="$(resolve_version)"

  local deb rpm bin
  bin="src-tauri/target/release/xfileviewer"

  case "$PM" in
    apt)
      deb="$(pick_stamped_bundle src-tauri/target/release/bundle/deb deb "$version")"
      install_deb "$deb" "$version"
      ;;
    dnf)
      rpm="$(pick_stamped_bundle src-tauri/target/release/bundle/rpm rpm "$version")"
      log "安装 $(abs_path "$rpm")（戳记版本 ${version}）"
      run_root dnf install -y "$(abs_path "$rpm")"
      ;;
    zypper)
      rpm="$(pick_stamped_bundle src-tauri/target/release/bundle/rpm rpm "$version")"
      log "安装 $(abs_path "$rpm")（戳记版本 ${version}）"
      run_root zypper --non-interactive install --allow-unsigned-rpm "$(abs_path "$rpm")"
      ;;
    pacman|*)
      [[ -x "$bin" ]] || die "未找到可执行文件: $bin"
      log "安装到 /usr/local/bin/xfileviewer"
      run_root install -Dm755 "$bin" /usr/local/bin/xfileviewer
      local desktop_src desktop_dst
      desktop_src="$(mktemp)"
      desktop_dst=/usr/local/share/applications/xfileviewer.desktop
      cat > "$desktop_src" <<'EOF'
[Desktop Entry]
Name=xfileviewer
Comment=本机图片/视频/Markdown 打开器
Exec=xfileviewer %F
Icon=xfileviewer
Terminal=false
Type=Application
Categories=Utility;Viewer;
MimeType=image/jpeg;image/png;image/gif;image/webp;image/bmp;image/svg+xml;video/mp4;video/webm;video/x-matroska;video/quicktime;video/x-msvideo;text/markdown;text/x-markdown;
EOF
      run_root install -Dm644 "$desktop_src" "$desktop_dst"
      rm -f "$desktop_src"
      if have update-desktop-database; then
        run_root update-desktop-database /usr/local/share/applications >/dev/null 2>&1 || true
      fi
      ;;
  esac

  log "安装完成。可执行: xfileviewer /path/to/file"
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

[[ "$(uname -s)" == Linux ]] || die "当前脚本仅支持 Linux"

detect_pm
install_system_deps
ensure_node
ensure_rust
stamp_version
build_app
install_app
