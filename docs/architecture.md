# Architecture

## Frontend

- `src/main.ts`: selects the main window or video overlay before loading UI code.
- `src/core/`: viewer contracts, plugin registry, path handling and file sequences.
- `src/shell/application.ts`: connects file opening, directory scan progress and application events.
- `src/shell/viewerSession.ts`: owns the active viewer and ignores callbacks from disposed sessions.
- `src/shell/associationController.ts`: owns the settings view and file association prompts.
- `src/shell/windowController.ts`: owns window fitting, remembered sizes and display mode controls.
- `src/plugins/`: built-in and external viewers. Video and Markdown implementations load on demand.

Viewer implementations own their DOM. The host uses `ViewerContext.onToolbar`
to dock shared controls and `ViewerHandle.setNavigation` to publish sequence
state. `isInteractionBlocked` prevents viewer shortcuts while settings or an
association prompt are open. These additions are optional for external plugins.

`lazyViewer` preserves the synchronous mount contract, buffers navigation state,
and cancels late mounts. Failed imports can be retried.

## Rust

`src-tauri/src/lib.rs` only assembles application state, plugins and IPC commands.
Commands keep their existing names except for the media stream lifecycle below.

- `launch.rs`: launch arguments and initial window title.
- `scan.rs` / `directory.rs`: streaming directory scan and platform filesystem access.
- `settings.rs`: persisted association preferences and window dimensions.
- `associations.rs`: operating-system file association behavior.
- `plugins.rs`: external plugin discovery and scoped file reads.
- `media_commands.rs`: IPC adapters for ordinary media streams.
- `media_server.rs`: authenticated loopback HTTP delivery with byte ranges.
- `hls_transcoder.rs`: ffmpeg session lifecycle and HLS cache paths.
- `native_video.rs`, `video_overlay.rs`, `video_drop.rs`: Windows native playback integration.

## Media Access

`video_stream_url({ path, session })` registers one file and returns a bearer URL:
`http://127.0.0.1:<port>/<random-token>/media/<session>`.
HTTP requests cannot supply a filesystem path. `video_stream_close({ session })`
revokes access, including when an asynchronous open finishes after viewer teardown.
Tokens are generated with UUID v4 for each process.

HLS playlists use the same token prefix. Relative segment URLs retain it, and
canonical path checks confine HLS reads to the session cache directory. Cross-origin
requests are restricted to the application origins and loopback development origins.
Bearer URLs must not be logged or shared.

This protects the HTTP boundary, not against code deliberately run inside a trusted
WebView. The existing Markdown raw-HTML execution policy and trusted external-plugin
model have not changed.

## Verification

Use Node 22 (`.nvmrc`) and `npm ci`. Vitest workers disable Node's experimental
Web Storage so jsdom consistently owns browser storage.

```sh
npm test
npm run build
npm run prepare:native
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
```

Windows native runtime extraction uses system tar, with installed `7z.exe` as a
fallback for unsupported archive codecs. The network-directory test is opt-in:
it requires `XFILEVIEWER_TEST_DIR` and is ignored in the standard suite.
