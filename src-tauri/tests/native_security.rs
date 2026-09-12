// 原位置为 app/tests/native-security.rs，头注释要求独立编译：
//   rustc --edition=2021 --test tests/native-security.rs
// 但其引入的 virtual_network.rs 依赖 tokio::net 与 windows::Win32，
// 单文件 rustc 无法链接外部 crate，必然编译失败。现迁入 src-tauri/tests
// 作为 Cargo 集成测试，依赖由 Cargo.toml 解析。运行方式：
//   cargo test --test native_security
#[path = "../src/modules/helper_handshake.rs"]
mod helper_handshake;
#[path = "../src/modules/hosts_security.rs"]
mod hosts_security;
#[path = "../src/modules/virtual_network.rs"]
mod virtual_network;
