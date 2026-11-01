#!/usr/bin/env bash
# Original Mourn packaging adapter; not a copy of the third-party plugin.
# Interface inputs (retrieved 2026-10-29; independent public contracts):
# https://github.com/linuxdeploy/linuxdeploy/wiki/Plugin-system
# https://docs.appimage.org/packaging-guide/from-source/linuxdeploy-user-guide.html
# https://github.com/linuxdeploy/linuxdeploy/blob/master/src/main.cpp
# https://gstreamer.freedesktop.org/documentation/gstreamer/running.html
# https://github.com/GStreamer/gstreamer/blob/main/subprojects/gstreamer/gst/gstpluginloader.c
# https://github.com/GStreamer/gstreamer/blob/main/subprojects/gstreamer/libs/gst/net/gstptpclock.c
# https://github.com/NixOS/patchelf/blob/master/README.md
# Local installed gstreamer-1.0.pc defines pluginsdir/pluginscannerdir. Mourn's
# integration contract defines the AppDir layout and final GPU-family pruning.
# Scope: GStreamer 1.0 ELF plugins/helpers, dependency delegation, relocation,
# runtime environment and cache isolation. No codec filtering or driver bundling.
# This provenance records implementation inputs; it is not legal clearance.
set -euo pipefail
fail() { printf 'mourn-gstreamer: %s\n' "$*" >&2; exit 2; }
if (( $# == 1 )); then
    case "$1" in
        --plugin-api-version) printf '0\n'; exit 0 ;;
        --help) printf '%s\n' 'Usage: linuxdeploy-plugin-gstreamer.sh --appdir DIR' \
            'GStreamer 1.0: GSTREAMER_PLUGINS_DIR and GSTREAMER_HELPERS_DIR override pkg-config discovery.' \
            'Requires LINUXDEPLOY_SHA256 and the fresh extraction staged by pin_linuxdeploy_for_bundling.sh.' \
            'All installed ELF plugins are retained; GSTREAMER_INCLUDE_BAD_PLUGINS is a compatibility no-op.'; exit 0 ;;
    esac
fi
[[ $# == 2 && $1 == --appdir && -n $2 && -d $2 ]] || fail 'expected --appdir with one existing directory'
APPDIR=$(realpath -e -- "$2")
[[ ${GSTREAMER_VERSION:-1.0} == 1.0 ]] || fail 'only GStreamer 1.0 is supported'
plugins=${GSTREAMER_PLUGINS_DIR:-$(pkg-config --variable=pluginsdir gstreamer-1.0)}
helpers=${GSTREAMER_HELPERS_DIR:-$(pkg-config --variable=pluginscannerdir gstreamer-1.0)}
[[ -n $plugins && -d $plugins ]] || fail 'missing GStreamer plugin directory'
[[ -n $helpers && -d $helpers ]] || fail 'missing GStreamer helper directory'
for tool in patchelf sha256sum find sort xargs od realpath; do
    command -v "$tool" >/dev/null || fail "required tool missing: $tool"
done
plugins=$(realpath -e -- "$plugins")
helpers=$(realpath -e -- "$helpers")
[[ $APPDIR != / ]] || fail 'AppDir must not be the filesystem root'

# Only linuxdeploy-stable/squashfs-root/AppRun from the trust prerequisite is
# eligible. Ignore LINUXDEPLOY/LINUXDEPLOY_BIN: callers cannot select executables.
stable=${XDG_CACHE_HOME:-$HOME/.cache}/tauri/linuxdeploy-stable
trusted=$stable/squashfs-root
[[ ! -L $stable && ! -L $trusted ]] || fail 'refusing symlink extraction root'
[[ ${LINUXDEPLOY_SHA256:-} =~ ^[0-9a-fA-F]{64}$ ]] || fail 'independently reviewed LINUXDEPLOY_SHA256 is required'
expected=${LINUXDEPLOY_SHA256,,}
[[ -f $stable/source.sha256 && $(<"$stable/source.sha256") == "$expected" ]] || fail 'unbound linuxdeploy cache; rerun trust prerequisite'
case $(uname -m) in
    x86_64|amd64) arch=x86_64 ;; aarch64|arm64) arch=aarch64 ;;
    armv7l|armhf) arch=armhf ;; i686|i386) arch=i386 ;;
    *) fail 'unsupported architecture' ;;
esac
image=$stable/linuxdeploy-$arch.AppImage
[[ -f $image && ! -L $image ]] || fail 'missing bound linuxdeploy input'
printf '%s  %s\n' "$expected" "$image" | sha256sum --check --status || fail 'linuxdeploy input digest mismatch'
[[ -d $trusted && -f $stable/extracted.sha256 && -x $trusted/AppRun ]] || fail 'missing verified extraction manifest or AppRun'
trusted=$(realpath -e -- "$trusted")
work=$(mktemp -d "${TMPDIR:-/tmp}/mourn-gstreamer.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
find "$trusted" -type l -print0 > "$work/links"
while IFS= read -r -d '' link; do
    target=$(realpath -e -- "$link") || fail "broken extraction symlink: $link"
    [[ $target == "$trusted/"* ]] || fail 'extraction symlink escapes trusted tree'
done < "$work/links"
( cd -- "$trusted"; find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum ) > "$work/extracted.sha256"
cmp -s "$stable/extracted.sha256" "$work/extracted.sha256" || fail 'extraction integrity mismatch; rerun trust prerequisite'

# Materialize file symlinks as regular ELF files, not build-host absolute links.
# Preserve every installed ELF plugin (including bad/ugly/libav); the legacy
# GSTREAMER_INCLUDE_BAD_PLUGINS flag is accepted but never excludes codecs.
collect() {
    local source=$1 output=$2 entry target relative count=0
    mkdir -p -- "$output"
    find "$source" \( -type f -o -type l \) -print0 > "$work/entries"
    while IFS= read -r -d '' entry; do
        target=$(realpath -e -- "$entry") || fail "broken media symlink: $entry"
        [[ $target == "$source/"* ]] || fail "media symlink escapes source directory: $entry"
        [[ -f $target ]] || fail "media entry is not a regular file: $entry"
        [[ $(od -An -tx1 -N4 "$target" | tr -d ' \n') == 7f454c46 ]] || continue
        relative=${entry#"$source/"}
        mkdir -p -- "$output/$(dirname -- "$relative")"
        install -m755 -- "$target" "$output/$relative"
        count=$((count + 1))
    done < "$work/entries"
    (( count > 0 )) || fail "no ELF files in media directory: $source"
}
collect "$plugins" "$work/plugins"
collect "$helpers" "$work/helpers"
[[ -x $work/helpers/gst-plugin-scanner ]] || fail 'missing ELF gst-plugin-scanner'
plugin_dest=$APPDIR/usr/lib/gstreamer-1.0
helper_dest=$APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0
hook=$APPDIR/apprun-hooks/linuxdeploy-plugin-gstreamer.sh
for dest in "$plugin_dest" "$helper_dest" "$hook"; do
    [[ $(realpath -m -- "$dest") == "$APPDIR/"* ]] || fail 'destination escapes AppDir'
done
# These two media directories are exclusively owned by this helper. Before
# replacing them, reject symlink aliases in every destination path component
# and in any old media tree. Containment alone permits aliases to unrelated
# locations inside the AppDir. Inputs have already been fully staged/validated;
# a missing scanner or invalid source must not destroy the prior AppDir.
for dest in "$plugin_dest" "$helper_dest"; do
    component=$dest
    while [[ $component != "$APPDIR" ]]; do
        [[ ! -L $component ]] || fail "media destination symlink: $component"
        component=$(dirname -- "$component")
    done
    if [[ -d $dest ]]; then
        find "$dest" -type l -print0 > "$work/destination-links"
        [[ ! -s $work/destination-links ]] || fail "media destination contains symlink: $dest"
    fi
done
mkdir -p -- "$APPDIR/apprun-hooks"
rm -f -- "$hook"
# From here failures leave an incomplete AppDir and must abort the outer build.
trap 'status=$?; if (( status != 0 )); then printf "%s\n" "mourn-gstreamer: incomplete AppDir; discard/rebuild before packaging" >&2; fi; rm -rf -- "$work"' EXIT
# Reconcile only owned media trees, never usr/lib or the gstreamer1.0 parent.
# Overlaying would keep removed/renamed plugins in the dependency/runtime scan.
rm -rf -- "$plugin_dest" "$helper_dest"
mkdir -p -- "$plugin_dest" "$helper_dest"
copy_into() {
    local source=$1 dest=$2 entry relative
    find "$source" -type f -print0 > "$work/copies"
    while IFS= read -r -d '' entry; do
        relative=${entry#"$source/"}
        [[ $(realpath -m -- "$dest/$relative") == "$APPDIR/"* ]] || fail 'file destination escapes AppDir'
        mkdir -p -- "$dest/$(dirname -- "$relative")"
        rm -f -- "$dest/$relative"
        install -m755 -- "$entry" "$dest/$relative"
    done < "$work/copies"
}
copy_into "$work/plugins" "$plugin_dest"
copy_into "$work/helpers" "$helper_dest"
args=(--appdir "$APPDIR")
find "$plugin_dest" "$helper_dest" -type f -print0 > "$work/dependencies"
while IFS= read -r -d '' entry; do
    [[ $(od -An -tx1 -N4 "$entry" | tr -d ' \n') == 7f454c46 ]] || continue
    args+=(--deploy-deps-only "$entry")
done < "$work/dependencies"
# --deploy-deps-only retains the plugin/helper locations and resolves their ELF
# dependencies; do not pass --plugin here (that would recursively invoke us).
"$trusted/AppRun" "${args[@]}"
while IFS= read -r -d '' entry; do
    [[ $(od -An -tx1 -N4 "$entry" | tr -d ' \n') == 7f454c46 ]] || continue
    relative=$(realpath --relative-to="$(dirname -- "$entry")" "$APPDIR/usr/lib")
    patchelf --set-rpath "\$ORIGIN:\$ORIGIN/$relative" "$entry"
done < "$work/dependencies"
# Prune last, after dependency deployment. Keep this explicit policy aligned
# with GTK's MOURN LOCAL CHANGE 3: never match libvamp/libvault or arbitrary
# libvulkan-prefixed libraries. VA GLX is present in installed libva metadata;
# no libva-wayland is installed here. Vendor filenames are bound to the local
# /usr/share/vulkan/icd.d/*.json library_path inventory inspected 2026-10-29.
# New vendor names require evidence and an explicit addition, not a wildcard.
graphics_patterns=(
    'libva.so' 'libva.so.*'
    'libva-drm.so' 'libva-drm.so.*'
    'libva-x11.so' 'libva-x11.so.*'
    'libva-glx.so' 'libva-glx.so.*'
    'libvulkan.so' 'libvulkan.so.*'
    'libvulkan_asahi.so' 'libvulkan_intel_hasvk.so' 'libvulkan_lvp.so'
    'libvulkan_nouveau.so' 'libvulkan_virtio.so' 'libvulkan_radeon.so'
    'libvulkan_intel.so' 'libvulkan_gfxstream.so'
)
for libroot in "$APPDIR"/usr/lib* "$APPDIR"/lib*; do
    [[ -d $libroot ]] || continue
    for pattern in "${graphics_patterns[@]}"; do
        find "$libroot" \( -type f -o -type l \) -name "$pattern" -delete
    done
done
cat > "$work/hook" <<'RUNTIME'
#!/bin/sh
# Sourced by linuxdeploy's AppRun after APPDIR has been located at runtime.
: "${APPDIR:?AppRun must set APPDIR}"
export GST_PLUGIN_PATH_1_0="$APPDIR/usr/lib/gstreamer-1.0"
export GST_PLUGIN_SYSTEM_PATH_1_0="$GST_PLUGIN_PATH_1_0"
export GST_PLUGIN_SCANNER_1_0="$APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
export GST_PTP_HELPER_1_0="$APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0/gst-ptp-helper"
# Isolate this application's registry from the host and from other mount paths.
_mourn_gst_key=$(printf '%s' "$APPDIR" | cksum)
_mourn_gst_key=${_mourn_gst_key%% *}
_mourn_gst_cache=${XDG_CACHE_HOME:-${HOME:?HOME or XDG_CACHE_HOME is required}/.cache}/mourn/gstreamer-1.0
mkdir -p -- "$_mourn_gst_cache" || return 1
export GST_REGISTRY_1_0="$_mourn_gst_cache/registry-$_mourn_gst_key.bin"
unset _mourn_gst_cache _mourn_gst_key
RUNTIME
install -m644 -- "$work/hook" "$hook"
printf '%s\n' 'mourn-gstreamer: ELF plugins, helpers, dependencies and runtime hook bundled'
