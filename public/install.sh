#!/usr/bin/env bash
# ZZ Programming Language installer — Linux & macOS
# Usage:
#   curl -fsSL https://zz-lang.pages.dev/install.sh | sh
# Pin a version:
#   curl -fsSL https://zz-lang.pages.dev/install.sh | ZZ_VERSION=v0.1.6 sh
# Re-running updates an existing install to the latest version.
set -u

REPO="zaidejjo/zz"
INSTALL_DIR="${ZZ_INSTALL_DIR:-$HOME/.zz/bin}"
WANT_VERSION="${ZZ_VERSION:-latest}"

# ---------- colors (disabled when not a tty or NO_COLOR set) ----------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
	BOLD='\033[1m'
	DIM='\033[2m'
	RESET='\033[0m'
	BLUE='\033[34m'
	CYAN='\033[36m'
	GREEN='\033[32m'
	YELLOW='\033[33m'
	RED='\033[31m'
	MAGENTA='\033[35m'
else
	BOLD=''
	DIM=''
	RESET=''
	BLUE=''
	CYAN=''
	GREEN=''
	YELLOW=''
	RED=''
	MAGENTA=''
fi

info() { printf "%b==>%b %s\n" "$BLUE" "$RESET" "$*"; }
ok() { printf "%b✓%b %s\n" "$GREEN" "$RESET" "$*"; }
warn() { printf "%b!%b %s\n" "$YELLOW" "$RESET" "$*"; }
fatal() {
	printf "%b✗ %s%b\n" "$RED" "$*" "$RESET" >&2
	exit 1
}

step() { # $1=current $2=total $3=message
	filled=$1
	total=$2
	width=24
	n=$((filled * width / total))
	bar=""
	i=0
	while [ "$i" -lt "$width" ]; do
		if [ "$i" -lt "$n" ]; then bar="${bar}━"; else bar="${bar}─"; fi
		i=$((i + 1))
	done
	printf "%b[%s]%b %s\n" "$CYAN" "$bar" "$RESET" "$3"
}

banner() {
	printf "%b\n" "${CYAN}${BOLD}"
	printf "  ███████╗███████╗\n"
	printf "  ╚══███╔╝╚══███╔╝\n"
	printf "    ███╔╝    ███╔╝ \n"
	printf "   ███╔╝    ███╔╝  \n"
	printf "  ███████╗ ███████╗\n"
	printf "  ╚══════╝ ╚══════╝%b\n" "$RESET"
	printf "%bZZ installer%b — Linux & macOS  %s%s%s\n" "$BOLD" "$RESET" "$DIM" "($REPO)" "$RESET"
}

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || fatal "missing required command: $1 (install it and re-run)"
}

banner

# ---------- 1/5 detect platform ----------
step 1 6 "Detecting platform…"
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
Linux) OS_ID="linux" ;;
Darwin) OS_ID="macos" ;;
*) fatal "unsupported OS: $OS (only Linux and macOS are supported by this script; Windows uses install.ps1)" ;;
esac
case "$ARCH" in
x86_64 | amd64) ARCH_ID="x86_64" ;;
arm64 | aarch64) ARCH_ID="aarch64" ;;
*) fatal "unsupported architecture: $ARCH (only x86_64 and aarch64 are supported)" ;;
esac
ok "platform: ${OS_ID}-${ARCH_ID}"

need_cmd mktemp
command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 ||
	fatal "need curl or wget to download"
command -v unzip >/dev/null 2>&1 || fatal "need unzip to extract (install it and re-run)"

# ---------- 2/5 resolve version ----------
step 2 6 "Resolving version…"
TAG="$WANT_VERSION"
if [ "$TAG" = "latest" ]; then
	if command -v curl >/dev/null 2>&1; then
		TAG="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep -m1 '"tag_name"' | cut -d'"' -f4 || true)"
	else
		TAG="$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep -m1 '"tag_name"' | cut -d'"' -f4 || true)"
	fi
	if [ -z "$TAG" ]; then
		# Fallback: follow the /releases/latest redirect (no API / no jq needed)
		if command -v curl >/dev/null 2>&1; then
			LOC="$(curl -fsSIL -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest" 2>/dev/null || true)"
		else
			LOC="$(wget -S --max-redirect=5 --spider "https://github.com/${REPO}/releases/latest" 2>&1 | grep -m1 -i '^  Location:' | awk '{print $2}' | tr -d '\r' || true)"
		fi
		TAG="${LOC##*/}"
	fi
	[ -n "$TAG" ] || fatal "could not resolve latest release (check network or set ZZ_VERSION=vX.Y.Z)"
fi
case "$TAG" in
v*) VER="${TAG#v}" ;;
*) fatal "invalid version tag: $TAG (expected vX.Y.Z)" ;;
esac
info "version: $TAG"

# Already up to date?
INSTALLED=""
if command -v zz >/dev/null 2>&1; then
	INSTALLED="$(zz --version 2>/dev/null | grep -m1 -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
	if [ "$INSTALLED" = "$VER" ]; then
		ok "zz $TAG already installed — nothing to do."
		printf "  run %bzz --version%b to verify.\n" "$BOLD" "$RESET"
		exit 0
	elif [ -n "$INSTALLED" ]; then
		warn "found zz $INSTALLED — updating to $TAG…"
	fi
fi

# ---------- 3/5 download ----------
step 3 6 "Downloading zz $TAG…"
ZIP="zz-${VER}-${OS_ID}-${ARCH_ID}.zip"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ZIP}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT INT TERM

if command -v curl >/dev/null 2>&1; then
	curl -fSL --progress-bar "$URL" -o "$TMPDIR/$ZIP" ||
		fatal "download failed: $URL (release may not ship ${OS_ID}-${ARCH_ID} yet)"
else
	(cd "$TMPDIR" && wget --show-progress --progress=bar:force "$URL" -O "$ZIP") ||
		fatal "download failed: $URL (release may not ship ${OS_ID}-${ARCH_ID} yet)"
fi
ok "downloaded $ZIP"

# ---------- 4/5 install ----------
step 4 6 "Installing to $INSTALL_DIR…"
unzip -q -o "$TMPDIR/$ZIP" -d "$TMPDIR/pkg" ||
	fatal "could not unzip $ZIP"
# Asset layout: zip contains zz (+ zz-lsp) at top level or under dist/.
BIN_SRC="$(dirname "$(find "$TMPDIR/pkg" -maxdepth 2 -name 'zz' -type f -print -quit)")"
[ -n "$BIN_SRC" ] && [ "$BIN_SRC" != "." ] || BIN_SRC="$TMPDIR/pkg"
[ -f "$BIN_SRC/zz" ] || fatal "zip did not contain a zz binary"
mkdir -p "$INSTALL_DIR"
if [ -f "$BIN_SRC/zz-lsp" ]; then
	cp -f "$BIN_SRC/zz" "$BIN_SRC/zz-lsp" "$INSTALL_DIR/"
	chmod +x "$INSTALL_DIR/zz" "$INSTALL_DIR/zz-lsp"
else
	cp -f "$BIN_SRC/zz" "$INSTALL_DIR/"
	chmod +x "$INSTALL_DIR/zz"
fi
ok "installed zz $TAG"

# ---------- 5/5 PATH ----------
step 5 6 "Setting up PATH…"
EXPORT_LINE='export PATH="$HOME/.zz/bin:$PATH"'
MARK_BEGIN="# >>> zz-lang installer >>>"
MARK_END="# <<< zz-lang installer <<<"
ensure_block() { # $1=file $2=line
	f="$1"
	line="$2"
	[ -e "$f" ] || : >"$f"
	if grep -qF "$MARK_BEGIN" "$f" 2>/dev/null; then return 0; fi
	if grep -qF "$line" "$f" 2>/dev/null; then return 0; fi
	{
		printf "\n%s\n%s\n%s\n" "$MARK_BEGIN" "$line" "$MARK_END"
	} >>"$f"
}

FISH_LINE='set -gx PATH $HOME/.zz/bin $PATH'
if [ "$OS_ID" = "macos" ] || [ "$OS_ID" = "linux" ]; then
	ensure_block "$HOME/.bashrc" "$EXPORT_LINE" && ok "bash:  ~/.bashrc"
	ensure_block "$HOME/.zshrc" "$EXPORT_LINE" && ok "zsh:   ~/.zshrc"
	mkdir -p "$HOME/.config/fish"
	if grep -qF "$MARK_BEGIN" "$HOME/.config/fish/config.fish" 2>/dev/null ||
		grep -qF "$FISH_LINE" "$HOME/.config/fish/config.fish" 2>/dev/null; then
		ok "fish:  ~/.config/fish/config.fish (already set)"
	else
		{
			printf "\n%s\n%s\n%s\n" "$MARK_BEGIN" "$FISH_LINE" "$MARK_END"
		} >>"$HOME/.config/fish/config.fish"
		ok "fish:  ~/.config/fish/config.fish"
	fi
fi

case ":$PATH:" in
*":$INSTALL_DIR:"* | *":$HOME/.zz/bin:"*) ON_PATH=1 ;;
*) ON_PATH=0 ;;
esac
if [ "$ON_PATH" = "0" ]; then
	export PATH="$INSTALL_DIR:$PATH"
	warn "current shell updated for this session only."
	printf "  restart your shell, or run:\n  %b%s%b\n" "$BOLD" "$EXPORT_LINE" "$RESET"
fi

# ---------- setup: PATH + completions ----------
step 6 6 "Wiring up shell (zz setup)…"
if [ -x "$INSTALL_DIR/zz" ]; then
	"$INSTALL_DIR/zz" setup --yes || warn "zz setup needs attention — run 'zz setup' manually."
fi

# ---------- verify ----------
if "$INSTALL_DIR/zz" --version >/dev/null 2>&1; then
	INSTALLED_VER="$("$INSTALL_DIR/zz" --version 2>/dev/null | head -n1)"
	printf "\n%b%s congratulations — %s is ready!%b\n" "$GREEN$BOLD" "★" "$INSTALLED_VER" "$RESET"
else
	fatal "install finished but $INSTALL_DIR/zz does not run"
fi

printf "\nNext steps:\n"
printf "  %bzz run hello.zz%b   run a program\n" "$BOLD" "$RESET"
printf "  %bzz --help%b         see all commands\n" "$BOLD" "$RESET"
printf "Tools installed with %bzz install%b also land in %b~/.zz/bin%b.\n" "$BOLD" "$RESET" "$DIM" "$RESET"
