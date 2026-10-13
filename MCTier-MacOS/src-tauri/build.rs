fn main() {
    // Model preparation happens on the build machine, never on the user's device.
    let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("..");
    for file in ["shared/speech-model.json", "scripts/prepare-speech-model.mjs", "shared/generated/speech-model/model.int8.onnx.gzip", "shared/generated/speech-model/tokens.txt", "shared/builtin-emoji/builtin-v3.pack.gz"] {
        println!("cargo:rerun-if-changed={}", root.join(file).display());
    }
    let status = std::process::Command::new("node")
        .arg(root.join("scripts/prepare-speech-model.mjs"))
        .status().expect("Node.js is required to prepare the bundled speech model");
    assert!(status.success(), "Bundled speech model preparation failed");
    #[cfg(windows)]
    {
        // RCDATA keeps compressed model data out of LLVM IR during optimization.
        let model_path = root.join("shared/generated/speech-model/model.int8.onnx.gzip")
            .display().to_string().replace('\\', "/");
        let emoji_path = root.join("shared/builtin-emoji/builtin-v3.pack.gz")
            .display().to_string().replace('\\', "/");
        let rc = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("speech-model.rc");
        std::fs::write(&rc, format!("#pragma code_page(65001)\nMCTIER_SPEECH_MODEL 10 \"{model_path}\"\nMCTIER_BUILTIN_EMOJI_PACK 11 \"{emoji_path}\"\n"))
            .expect("write bundled speech and emoji resources");
        embed_resource::compile_for_everything(&rc, embed_resource::NONE)
            .manifest_required().expect("compile bundled speech and emoji resources");
        let mut windows = tauri_build::WindowsAttributes::new();
        windows = windows.app_manifest(
            r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#,
        );
        let attrs = tauri_build::Attributes::new().windows_attributes(windows);
        tauri_build::try_build(attrs).expect("failed to run build script");

        // 上面的 app_manifest 只会嵌入到应用自身的可执行文件里，`cargo test` 生成的
        // 测试二进制拿不到它。而依赖链中静态导入了 comctl32 的 `TaskDialogIndirect`，
        // 该导出只存在于并行程序集里的 comctl32 v6；缺少清单时加载的是 System32 下的
        // v5.82，于是测试进程在入口点就以 STATUS_ENTRYPOINT_NOT_FOUND(0xC0000139) 崩溃，
        // 导致整个 Rust 测试套件无法运行。这里给测试目标单独补上同一份程序集依赖。
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' \
             name='Microsoft.Windows.Common-Controls' version='6.0.0.0' \
             processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }

    #[cfg(not(windows))]
    {
        tauri_build::build()
    }
}
