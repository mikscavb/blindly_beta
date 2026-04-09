  <p align="center">
    <img src="design/blindly%20icon.png" alt="Blindly icon" width="160">
  </p>

# Blindly

Blindly is a local-first desktop app for blind smelling evaluation of perfume materials.

Current public release: `1.0.0`

## What It Does

- run blind sessions without revealing answers until the final report
- manage materials and bottles locally
- review long-term performance and session history
- import materials and bottles from CSV
- export and restore the local SQLite database

## Installers

Installer assets should be downloaded from the repository's
[GitHub Releases](https://github.com/mikscavb/blindly_beta/releases).

Important:

- Windows installers are unsigned. Microsoft Defender SmartScreen may show a
  `Windows protected your PC` warning before launch.
- macOS builds are unsigned and not notarized. Gatekeeper may warn that the app
  is from an unidentified developer, cannot be verified, or is damaged.
- If that trust model feels wrong, do not install the release asset. Build the
  app from source from the tagged release instead.

### Windows

On Windows, the normal unsigned-installer flow is:

1. Download the installer from GitHub Releases.
2. Open it.
3. If SmartScreen appears, click `More info`.
4. Click `Run anyway` only if you trust the repo and release you downloaded.

### macOS

On macOS, Gatekeeper may block first launch for an unsigned app.

Try the safer built-in path first:

1. Attempt to open the app.
2. Open `System Settings` -> `Privacy & Security`.
3. Use `Open Anyway` if the app appears there.

If macOS still blocks launch because of the quarantine flag, the common terminal
command is:

```bash
xattr -dr com.apple.quarantine "/Applications/Blindly.app"
```

If the app is still in Downloads or another folder, use the actual app path:

```bash
xattr -dr com.apple.quarantine "$HOME/Downloads/Blindly.app"
```

Only do this if you trust the exact app bundle you downloaded from this repo.

## Build From Source

If you do not want to run an unsigned installer, build Blindly locally.

### 1. Install prerequisites

Blindly uses Tauri. The official prerequisites guide is here:

- https://v2.tauri.app/start/prerequisites/

Windows:

- Node.js LTS
- Rust stable with the MSVC toolchain
- Microsoft C++ Build Tools with `Desktop development with C++`
- Microsoft Edge WebView2 Runtime
- If MSI bundling fails with `light.exe` / VBSCRIPT-related errors, enable the
  Windows `VBSCRIPT` optional feature

macOS:

- Node.js LTS
- Rust stable
- Xcode Command Line Tools via `xcode-select --install`

### 2. Clone the repository

```bash
git clone https://github.com/mikscavb/blindly_beta.git
cd blindly_beta
```

### 3. Install dependencies

```bash
npm install
```

### 4. Run the desktop app locally

```bash
npm run tauri:dev
```

### 5. Build the app yourself

```bash
npm run build
npm run tauri:build
```

Tauri places bundled output under `src-tauri/target/release/bundle/`.

## Example Import Files

This public repo includes sanitized example CSV files:

- [import example docs/materials_import_example.csv](import%20example%20docs/materials_import_example.csv)
- [import example docs/bottles with codes initial import.csv](import%20example%20docs/bottles%20with%20codes%20initial%20import.csv)

The materials example file is intentionally limited to:

- `name`
- `cas`

## Key Features

- start a session with a selected batch size
- enter bottle codes, search/select guessed materials, add notes, and queue bottles through a session
- skip bottles during a session, including shortening the session intentionally
- reveal the final session report after capture completes
- persist revealed attempts and session notes locally in SQLite
- review long-term performance trends, per-material accuracy, confusion pairs, and historical sessions
- create, edit, archive, and unarchive materials and bottles
- generate assignable bottle codes while keeping archived codes permanently unavailable
- preview and commit recurring material and bottle CSV imports
- export and restore the full local SQLite database using native file dialogs

## Notes

- The app stores its SQLite database in the Tauri app data directory.
- The bottle-code field autofocuses when a session starts and after advancing to the next bottle.
- This public repo is intentionally trimmed to runnable app source, build/config files, runtime assets, and example import files.
- Internal planning docs and extra private reference material from the working repo are not included here.

## Current Gaps

- export flows for attempts, sessions, materials, and bottles
- signed and notarized distribution
- broader release workflow polish
