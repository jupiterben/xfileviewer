#!/usr/bin/env bash
# 按当前系统设计转到对应的一键编译安装脚本
if [ -z "${BASH_VERSION:-}" ]; then
  if command -v bash >/dev/null 2>&1; then
    exec bash "$0" "$@"
  fi
  echo "错误: 需要 bash" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$(uname -s)" in
  Darwin) exec bash "$ROOT/install_macos.sh" "$@" ;;
  Linux) exec bash "$ROOT/install_linux.sh" "$@" ;;
  *)
    echo "错误: 当前系统请使用 install.bat（Windows）" >&2
    exit 1
    ;;
esac
