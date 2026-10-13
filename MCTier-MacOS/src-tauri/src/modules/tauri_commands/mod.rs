//! Tauri command facade grouped by user-facing domain.

mod shared;
pub use shared::*;

mod session;
pub use session::*;

mod network;
pub use network::*;

mod file_share;
pub use file_share::*;

mod remote_files;
pub use remote_files::*;

mod diagnostics;
pub use diagnostics::*;

mod archive;
pub use archive::*;

mod chat;
pub use chat::*;

mod overlays;
pub use overlays::*;

mod logging;
pub use logging::*;

mod settings;
pub use settings::*;
