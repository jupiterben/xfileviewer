mod directory;
mod hls_transcoder;
mod media_server;
#[cfg(windows)]
mod native_video;
#[cfg(windows)]
mod video_drop;
#[cfg(windows)]
mod video_overlay;

mod associations;
mod launch;
mod media_commands;
mod plugins;
mod scan;
mod settings;

use std::sync::{Arc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch = launch::first_file_arg(std::env::args());
    // HLS root resolved after the AppHandle is available; for now the media
    // server starts without HLS support, and the setup hook fills it in once
    // `app_cache_dir` is known.
    let hls_root: media_server::HlsCacheRoot = Arc::new(Mutex::new(None));
    let media_server =
        media_server::start_with_hls_root(hls_root.clone()).expect("start local media server");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(launch::LaunchState {
            path: Mutex::new(launch.clone()),
        })
        .manage(media_server)
        .manage(hls_transcoder::HlsTranscoder::default())
        .manage(hls_root.clone())
        .setup(move |app| {
            #[cfg(windows)]
            app.manage(native_video::NativeVideo::default());
            if let Some(path) = launch.as_deref() {
                launch::set_window_file_title(app.handle(), path);
            }
            // Bind the HLS cache root now that the app handle is alive. Any
            // request arriving before this completes gets 503 from the media
            // server, which the frontend treats as a transient failure.
            if let Ok(cache) = app.path().app_cache_dir() {
                if let Some(state) = app.try_state::<media_server::HlsCacheRoot>() {
                    if let Ok(mut guard) = state.lock() {
                        *guard = Some(cache);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch::take_launch_path,
            scan::parent_dir,
            scan::list_dir_files,
            settings::load_association_settings,
            settings::save_association_settings,
            settings::load_window_sizes,
            settings::save_window_sizes,
            associations::query_file_associations,
            associations::grant_file_associations,
            associations::revoke_file_associations,
            media_commands::video_stream_url,
            media_commands::video_stream_close,
            media_commands::native_video_available,
            hls_transcoder::ffmpeg_available,
            hls_transcoder::hls_open,
            hls_transcoder::hls_close,
            #[cfg(windows)]
            native_video::native_video_open,
            #[cfg(windows)]
            native_video::native_video_overlay,
            #[cfg(windows)]
            native_video::native_video_layout,
            #[cfg(windows)]
            native_video::native_video_control,
            #[cfg(windows)]
            native_video::native_video_status,
            #[cfg(windows)]
            native_video::native_video_close,
            plugins::list_plugin_dirs,
            plugins::read_plugin_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
