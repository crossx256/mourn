# Native Flatpak dependency recipes

The Ayatana AppIndicator, IDO, Indicator, libdbusmenu and intltool recipes and
patches originate from [flathub/shared-modules](https://github.com/flathub/shared-modules/tree/d1ab132e6480acefc5c510ee13d8d586d36cab19),
revision `d1ab132e6480acefc5c510ee13d8d586d36cab19`.

Local adjustments:

- Set `CMAKE_INSTALL_LIBDIR=lib` on each Ayatana CMake module so its libraries and
  pkg-config metadata use Flatpak's `/app/lib` search path, not `/app/lib64`.
- Preserve each bundled library's upstream `COPYING*` notices under
  `/app/share/licenses/bio.mourn.newlife/`.
- Keep Indicator's installed share files rather than deleting its license notices.

The library sources remain pinned by commit or archive SHA-256. Referenced
patches are included locally; the build does not retrieve patches at compile time.
Intltool is a build-only dependency and is removed from the final package.
Upstream recipe attribution does not establish that its contents use the Mourn
project license; retain all upstream notices and review their applicable terms.

GNOME supplies GTK, WebKitGTK and the other runtime libraries, but not the
AppIndicator library dynamically loaded by Tauri's tray implementation. A clean
`ldd` check alone does not verify this dependency: launch the finished package.
