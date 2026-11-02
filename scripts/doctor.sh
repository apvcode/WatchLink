#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo " WatchLink Doctor — Environment Check"
echo "========================================"

FAILED=0
WARN=0

# 1. Node.js check (>= 20)
echo -n "[1/7] Checking Node.js (>= 20 LTS)... "
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    echo "OK (v$NODE_VER)"
  else
    echo "FAIL (v$NODE_VER is older than 20)"
    FAILED=1
  fi
else
  echo "FAIL (Node.js not installed)"
  echo "  Fix: sudo pacman -S nodejs"
  FAILED=1
fi

# 2. Package manager (pnpm / npm)
echo -n "[2/7] Checking package manager (pnpm)... "
if command -v pnpm >/dev/null 2>&1; then
  PNPM_VER=$(pnpm -v)
  echo "OK (pnpm v$PNPM_VER)"
elif command -v npm >/dev/null 2>&1; then
  NPM_VER=$(npm -v)
  echo "WARN (pnpm missing, npm v$NPM_VER present)"
  echo "  Installing pnpm into user environment: npm install -g pnpm"
  npm install -g pnpm || true
else
  echo "FAIL (no npm or pnpm found)"
  FAILED=1
fi

# 3. JDK Check (17 or 21)
echo -n "[3/7] Checking JDK (17 or 21)... "
JDK_FOUND=0
if [ -d "$HOME/.jdks/jdk-21/bin" ]; then
  JDK_BIN="$HOME/.jdks/jdk-21/bin/java"
  VER=$("$JDK_BIN" -version 2>&1 | head -n 1)
  echo "OK (Arch OpenJDK in ~/.jdks/jdk-21: $VER)"
  export JAVA_HOME="$HOME/.jdks/jdk-21"
  JDK_FOUND=1
elif [ -d "$HOME/.jdks/jdk-17/bin" ]; then
  JDK_BIN="$HOME/.jdks/jdk-17/bin/java"
  VER=$("$JDK_BIN" -version 2>&1 | head -n 1)
  echo "OK (OpenJDK in ~/.jdks/jdk-17: $VER)"
  export JAVA_HOME="$HOME/.jdks/jdk-17"
  JDK_FOUND=1
elif [ -d "/usr/lib/jvm/java-17-openjdk/bin" ]; then
  VER=$(/usr/lib/jvm/java-17-openjdk/bin/java -version 2>&1 | head -n 1)
  echo "OK (System: $VER)"
  export JAVA_HOME="/usr/lib/jvm/java-17-openjdk"
  JDK_FOUND=1
else
  echo "FAIL (JDK 17/21 not found)"
  echo "  Fix option 1 (system): sudo pacman -S jdk17-openjdk"
  echo "  Fix option 2 (rootless): download & unpack Arch jdk21-openjdk into ~/.jdks/jdk-21"
  FAILED=1
fi

# 4. Android SDK & KVM
echo -n "[4/7] Checking Android SDK & KVM... "
ANDROID_SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
if [ -d "$ANDROID_SDK" ]; then
  echo "OK (SDK at $ANDROID_SDK)"
  if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
    echo "      KVM hardware acceleration: AVAILABLE (/dev/kvm is read/write)"
  else
    echo "      WARN: /dev/kvm not accessible by current user"
    WARN=1
  fi
  if command -v adb >/dev/null 2>&1; then
    DEVICES=$(adb devices | grep -v "List of" | grep -v "^$" || true)
    if [ -n "$DEVICES" ]; then
      echo "      Physical Android device detected:"
      echo "$DEVICES"
    else
      echo "      No physical device connected via adb"
    fi
  fi
else
  echo "FAIL (Android SDK not found at $ANDROID_SDK)"
  echo "  Fix: Install Android Studio or SDK commandline-tools"
  FAILED=1
fi

# 5. Gradle Wrapper
echo -n "[5/7] Checking Gradle wrapper... "
if [ -x "apps/android/gradlew" ]; then
  echo "OK (apps/android/gradlew present)"
else
  echo "FAIL (apps/android/gradlew missing or not executable)"
  FAILED=1
fi

# 6. ffmpeg
echo -n "[6/7] Checking ffmpeg... "
if command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG_VER=$(ffmpeg -version 2>&1 | head -n 1 | cut -d' ' -f3)
  echo "OK (v$FFMPEG_VER)"
else
  echo "FAIL (ffmpeg missing)"
  echo "  Fix: sudo pacman -S ffmpeg"
  FAILED=1
fi

# 7. Display / Wayland / X11 / Xvfb
echo -n "[7/7] Checking display server... "
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  echo "OK (Wayland active: $WAYLAND_DISPLAY)"
elif [ -n "${DISPLAY:-}" ]; then
  echo "OK (X11 active: $DISPLAY)"
elif command -v xvfb-run >/dev/null 2>&1; then
  echo "OK (Headless with xvfb-run)"
else
  echo "WARN (No DISPLAY/WAYLAND and xvfb-run not installed)"
  echo "  Fix for headless: sudo pacman -S xorg-server-xvfb"
  WARN=1
fi

echo "========================================"
if [ "$FAILED" -eq 0 ]; then
  echo "✓ Doctor check passed successfully!"
  exit 0
else
  echo "✗ Doctor check failed with $FAILED error(s). Please apply the recommended fixes above."
  exit 1
fi
