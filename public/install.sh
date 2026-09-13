#!/bin/bash
# ZZ Programming Language installer
# Usage: curl -fsSL https://zz-lang.pages.dev/install.sh | sh

set -e

REPO="https://github.com/zaidejjo/zz"
INSTALL_DIR="${ZZ_INSTALL_DIR:-$HOME/.local/bin}"

echo "Installing ZZ Programming Language..."

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
linux) PLATFORM="linux" ;;
darwin) PLATFORM="macos" ;;
*)
	echo "Unsupported OS: $OS"
	exit 1
	;;
esac

case "$ARCH" in
x86_64 | amd64) ARCH="x86_64" ;;
aarch64 | arm64) ARCH="aarch64" ;;
*)
	echo "Unsupported arch: $ARCH"
	exit 1
	;;
esac

BINARY_NAME="zz-${PLATFORM}-${ARCH}"
DOWNLOAD_URL="${REPO}/releases/latest/download/${BINARY_NAME}"

# Create install dir
mkdir -p "$INSTALL_DIR"

# Download
echo "Downloading ${BINARY_NAME}..."
curl -fsSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/zz"
chmod +x "${INSTALL_DIR}/zz"

# Check PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
	echo ""
	echo "Add to your PATH:"
	echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
	echo ""
fi

echo "Installed zz to ${INSTALL_DIR}/zz"
echo "Run 'zz --version' to verify."
