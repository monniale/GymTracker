# Android toolchain environment for GymTracker. Source it (POSIX sh, bash, zsh):
#   . scripts/android/env.sh
# JDK 21 *with javac* is required (@capacitor/android 8 compiles with Java 21). The distro
# openjdk-21-jre has no javac, so a JAVA_HOME without bin/javac is replaced by the first JDK found.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then
  for _gt_jdk in "$HOME/opt/jdk-21" /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/temurin-21-jdk-amd64; do
    if [ -x "$_gt_jdk/bin/javac" ]; then
      export JAVA_HOME="$_gt_jdk"
      break
    fi
  done
  unset _gt_jdk
fi
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then
  echo "env.sh: no JDK 21 with javac found (set JAVA_HOME, or unpack Temurin 21 to ~/opt/jdk-21)" >&2
fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/36.0.0:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$PATH"
