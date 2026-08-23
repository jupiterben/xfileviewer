#!/usr/bin/env bash
# xfileviewer 一键编译安装（Linux）
# `sh install.sh` 会走 dash，必须先转交 bash
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
MIN_NODE_MAJOR=18

usage() {
  cat <<'EOF'
用法: ./install.sh [选项]

  检查并安装系统依赖 / Node / Rust，编译 Tauri 应用，再安装到系统。

  --skip-deps    跳过系统依赖安装（仍检查 Node / Rust）
  --build-only   只编译，不安装
  -h, --help     显示帮助
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
      die "无法识别包管理器。请先按 Tauri 文档装好依赖，再运行: ./install.sh --skip-deps"
      ;;
  esac
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

  limit_build_jobs
  log "编译 xfileviewer"
  run_niced npm run tauri build -- "${extra[@]}"
}

install_app() {
  [[ "$BUILD_ONLY" -eq 1 ]] && { log "已跳过安装（--build-only）"; return 0; }

  local deb rpm bin
  shopt -s nullglob
  deb=(src-tauri/target/release/bundle/deb/*.deb)
  rpm=(src-tauri/target/release/bundle/rpm/*.rpm)
  bin="src-tauri/target/release/xfileviewer"
  shopt -u nullglob

  case "$PM" in
    apt)
      [[ ${#deb[@]} -ge 1 ]] || die "未找到 .deb 包"
      log "安装 ${deb[0]}"
      run_root apt-get install -y "$(abs_path "${deb[0]}")" || {
        run_root dpkg -i "$(abs_path "${deb[0]}")"
        run_root apt-get install -f -y
      }
      ;;
    dnf)
      [[ ${#rpm[@]} -ge 1 ]] || die "未找到 .rpm 包"
      log "安装 ${rpm[0]}"
      run_root dnf install -y "$(abs_path "${rpm[0]}")"
      ;;
    zypper)
      [[ ${#rpm[@]} -ge 1 ]] || die "未找到 .rpm 包"
      log "安装 ${rpm[0]}"
      run_root zypper --non-interactive install --allow-unsigned-rpm "$(abs_path "${rpm[0]}")"
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
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $arg（使用 -h 查看帮助）" ;;
  esac
done

[[ "$(uname -s)" == Linux ]] || die "当前脚本仅支持 Linux"

detect_pm
install_system_deps
ensure_node
ensure_rust
build_app
install_app
