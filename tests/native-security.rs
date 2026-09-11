// Run with: rustc --edition=2021 --test tests/native-security.rs -o <temporary executable>
#[path = "../src-tauri/src/modules/helper_handshake.rs"]
mod helper_handshake;
#[path = "../src-tauri/src/modules/hosts_security.rs"]
mod hosts_security;
#[path = "../src-tauri/src/modules/virtual_network.rs"]
mod virtual_network;
