use super::{output_size, FrameReply, Source};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Receiver,
        Arc,
    },
    time::{Duration, Instant},
};
use windows::{
    core::{factory, s, Interface, PCSTR},
    Foundation::TypedEventHandler,
    Graphics::{
        Capture::*,
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
        SizeInt32,
    },
    Win32::{
        Foundation::{BOOL, HMODULE, HWND, LPARAM, RECT},
        Graphics::{
            Direct3D::Fxc::D3DCompile,
            Direct3D::*,
            Direct3D11::*,
            Dxgi::{Common::*, IDXGIDevice},
            Gdi::*,
        },
        System::{
            Threading::GetCurrentProcessId,
            WinRT::{
                Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
                Graphics::Capture::IGraphicsCaptureItemInterop,
                RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED,
            },
        },
        UI::WindowsAndMessaging::*,
    },
};

pub fn sources() -> Result<Vec<Source>, String> {
    let mut items = Vec::<Source>::new();
    unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(monitor_callback),
            LPARAM(&mut items as *mut _ as isize),
        )
        .ok()
        .map_err(|e| e.to_string())?;
        EnumWindows(Some(window_callback), LPARAM(&mut items as *mut _ as isize))
            .map_err(|e| e.to_string())?;
    }
    items.sort_by_key(|s| (s.kind != "monitor", !s.primary, s.name.clone()));
    Ok(items)
}
unsafe extern "system" fn monitor_callback(
    monitor: HMONITOR,
    _: HDC,
    _: *mut RECT,
    data: LPARAM,
) -> BOOL {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(monitor, &mut info as *mut _ as *mut MONITORINFO).as_bool() {
        let items = &mut *(data.0 as *mut Vec<Source>);
        let rect = info.monitorInfo.rcMonitor;
        let name = String::from_utf16_lossy(
            &info.szDevice[..info.szDevice.iter().position(|c| *c == 0).unwrap_or(32)],
        );
        items.push(Source {
            id: format!("monitor:{}", monitor.0 as usize),
            name,
            kind: "monitor".into(),
            width: (rect.right - rect.left).max(0) as u32,
            height: (rect.bottom - rect.top).max(0) as u32,
            primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
        });
    }
    BOOL(1)
}
unsafe extern "system" fn window_callback(hwnd: HWND, data: LPARAM) -> BOOL {
    if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
        return BOOL(1);
    }
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == GetCurrentProcessId() {
        return BOOL(1);
    }
    let mut cloaked: u32 = 0;
    let _ = windows::Win32::Graphics::Dwm::DwmGetWindowAttribute(
        hwnd,
        windows::Win32::Graphics::Dwm::DWMWA_CLOAKED,
        &mut cloaked as *mut _ as _,
        4,
    );
    if cloaked != 0 || GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
        return BOOL(1);
    }
    let mut title = [0u16; 512];
    let len = GetWindowTextW(hwnd, &mut title);
    let mut rect = RECT::default();
    if len > 0
        && GetWindowRect(hwnd, &mut rect).is_ok()
        && rect.right > rect.left
        && rect.bottom > rect.top
    {
        (&mut *(data.0 as *mut Vec<Source>)).push(Source {
            id: format!("window:{}", hwnd.0 as usize),
            name: String::from_utf16_lossy(&title[..len as usize]),
            kind: "window".into(),
            width: (rect.right - rect.left) as u32,
            height: (rect.bottom - rect.top) as u32,
            primary: false,
        });
    }
    BOOL(1)
}

struct Apartment;
impl Apartment {
    fn new() -> windows::core::Result<Self> {
        // windows-rs caches agile activation factories for the process. Keep the MTA alive
        // across capture-worker exits so a later capture cannot reuse a torn-down factory.
        static MTA: std::sync::OnceLock<Result<usize, i32>> = std::sync::OnceLock::new();
        MTA.get_or_init(|| unsafe {
            windows::Win32::System::Com::CoIncrementMTAUsage()
                .map(|cookie| cookie.0 as usize)
                .map_err(|e| e.code().0)
        })
        .as_ref()
        .map_err(|code| windows::core::Error::from_hresult(windows::core::HRESULT(*code)))?;
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED)?;
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            RoUninitialize();
        }
    }
}
struct Capture {
    source_window: Option<HWND>,
    source_monitor: Option<HMONITOR>,
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    device: IDirect3DDevice,
    _item: GraphicsCaptureItem,
    size: SizeInt32,
    scaler: Scaler,
    closed: Arc<AtomicBool>,
}
impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}
impl Capture {
    fn new(source: &Source) -> windows::core::Result<Self> {
        unsafe {
            if !GraphicsCaptureSession::IsSupported()? {
                return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x80004001u32 as i32,
                )));
            }
            let handle = source
                .id
                .split_once(':')
                .and_then(|(_, s)| s.parse::<usize>().ok())
                .unwrap_or(0);
            let interop: IGraphicsCaptureItemInterop =
                factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
            let item: GraphicsCaptureItem = if source.kind == "monitor" {
                interop.CreateForMonitor(HMONITOR(handle as _))?
            } else {
                interop.CreateForWindow(HWND(handle as _))?
            };
            let mut d3d = None;
            let mut context = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut d3d),
                None,
                Some(&mut context),
            )?;
            let d3d = d3d.unwrap();
            let context = context.unwrap();
            let dxgi: IDXGIDevice = d3d.cast()?;
            let device: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()?;
            let size = item.Size()?;
            let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
                &device,
                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                2,
                size,
            )?;
            let session = pool.CreateCaptureSession(&item)?;
            // Never request borderless access: Windows' capture border is OS-owned, not browser chrome.
            let _ = session.SetIsCursorCaptureEnabled(true);
            let closed = Arc::new(AtomicBool::new(false));
            let notify = closed.clone();
            item.Closed(&TypedEventHandler::new(move |_, _| {
                notify.store(true, Ordering::Release);
                Ok(())
            }))?;
            let scaler = Scaler::new(d3d, context)?;
            session.StartCapture()?;
            Ok(Self {
                source_window: (source.kind == "window").then_some(HWND(handle as _)),
                source_monitor: (source.kind == "monitor").then_some(HMONITOR(handle as _)),
                session,
                pool,
                device,
                _item: item,
                size,
                scaler,
                closed,
            })
        }
    }
    fn frame(&mut self, resolution: u32, stop: &AtomicBool) -> Result<Vec<u8>, String> {
        let deadline = Instant::now() + Duration::from_millis(250);
        loop {
            // WGC Closed is not delivered consistently after a target window is destroyed.
            let source_exists = unsafe {
                self.source_window
                    .is_none_or(|window| IsWindow(window).as_bool())
                    && self.source_monitor.is_none_or(|monitor| {
                        let mut info = MONITORINFO {
                            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                            ..Default::default()
                        };
                        GetMonitorInfoW(monitor, &mut info).as_bool()
                    })
            };
            if !source_exists {
                return Err("共享目标已关闭或显示器已断开".into());
            }
            if stop.load(Ordering::Acquire) || self.closed.load(Ordering::Acquire) {
                return Err("共享目标已关闭或采集已停止".into());
            }
            match self.pool.TryGetNextFrame() {
                Ok(mut frame) => {
                    // Drain at most the second pool slot, so a slow consumer gets the newest frame.
                    if let Ok(newer) = self.pool.TryGetNextFrame() {
                        let _ = frame.Close();
                        frame = newer;
                    }
                    let result = (|| -> windows::core::Result<Option<Vec<u8>>> {
                        let size = frame.ContentSize()?;
                        if size.Width <= 0 || size.Height <= 0 {
                            return Ok(None);
                        }
                        if size != self.size {
                            frame.Close()?;
                            self.pool.Recreate(
                                &self.device,
                                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                                2,
                                size,
                            )?;
                            self.size = size;
                            return Ok(None);
                        }
                        let surface: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
                        let texture: ID3D11Texture2D = unsafe { surface.GetInterface()? };
                        let (width, height) =
                            output_size(size.Width as u32, size.Height as u32, resolution);
                        unsafe { self.scaler.render(&texture, width, height).map(Some) }
                    })();
                    let _ = frame.Close();
                    match result {
                        Ok(Some(bytes)) => return Ok(bytes),
                        Ok(None) => {}
                        Err(e) => return Err(e.to_string()),
                    }
                }
                // WinRT returns S_OK with a null interface when no frame is ready.
                // windows-rs represents that as Error(S_OK), not only E_POINTER.
                Err(error) if error.code().0 == 0 || error.code().0 == 0x80004003u32 as i32 => {}
                Err(error) => return Err(error.to_string()),
            }
            if Instant::now() >= deadline {
                return Ok(Vec::new());
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    #[test]
    #[ignore = "Requires an interactive Windows desktop and a D3D11 device"]
    fn real_monitor_capture_and_gpu_scaling() {
        let _apartment = Apartment::new().unwrap();
        let source = sources()
            .unwrap()
            .into_iter()
            .find(|s| s.kind == "monitor" && s.primary)
            .expect("primary display");
        let mut capture = Capture::new(&source).unwrap();
        let stop = AtomicBool::new(false);
        let deadline = Instant::now() + Duration::from_secs(5);
        let frame = loop {
            let bytes = capture.frame(720, &stop).unwrap();
            if !bytes.is_empty() {
                break bytes;
            }
            assert!(Instant::now() < deadline, "no frame received");
        };
        let width = u32::from_le_bytes(frame[0..4].try_into().unwrap());
        let height = u32::from_le_bytes(frame[4..8].try_into().unwrap());
        assert_eq!(
            (width, height),
            output_size(capture.size.Width as u32, capture.size.Height as u32, 720)
        );
        eprintln!(
            "Native display frame: {}x{} -> {width}x{height}",
            capture.size.Width, capture.size.Height
        );
        assert_eq!(frame.len(), 8 + width as usize * height as usize * 4);
        assert!(frame[8..].chunks_exact(4).all(|p| p[3] == 255));
        // Verify the shader's RGB order/orientation with a known texture, independent of desktop content.
        unsafe {
            let pixels: [u8; 16] = [
                0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255,
            ];
            let desc = D3D11_TEXTURE2D_DESC {
                Width: 2,
                Height: 2,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
                ..Default::default()
            };
            let data = D3D11_SUBRESOURCE_DATA {
                pSysMem: pixels.as_ptr() as _,
                SysMemPitch: 8,
                SysMemSlicePitch: 16,
            };
            let mut texture = None;
            capture
                .scaler
                .device
                .CreateTexture2D(&desc, Some(&data), Some(&mut texture))
                .unwrap();
            let result = capture.scaler.render(&texture.unwrap(), 2, 2).unwrap();
            assert_eq!(
                &result[8..],
                &[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]
            );
        }
        stop.store(true, Ordering::Release);
        assert!(capture.frame(720, &stop).is_err());
    }

    #[test]
    #[ignore = "Requires an interactive Windows desktop; briefly creates a test window"]
    fn real_window_resize_and_close_end_capture() {
        let _apartment = Apartment::new().unwrap();
        struct TestWindow(HWND);
        impl Drop for TestWindow {
            fn drop(&mut self) {
                unsafe {
                    let _ = DestroyWindow(self.0);
                }
            }
        }
        let window = TestWindow(unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                windows::core::w!("STATIC"),
                windows::core::w!("MCTier capture verification"),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                10,
                10,
                320,
                240,
                None,
                None,
                None,
                None,
            )
            .unwrap()
        });
        let source = Source {
            id: format!("window:{}", window.0 .0 as usize),
            name: "test".into(),
            kind: "window".into(),
            width: 320,
            height: 240,
            primary: false,
        };
        eprintln!("Window test: created target");
        let mut capture = Capture::new(&source).unwrap();
        eprintln!("Window test: capture started");
        let stop = AtomicBool::new(false);
        let wait_frame = |capture: &mut Capture| {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let bytes = capture.frame(720, &stop).unwrap();
                if !bytes.is_empty() {
                    return bytes;
                }
                assert!(Instant::now() < deadline);
            }
        };
        let first = wait_frame(&mut capture);
        eprintln!("Window test: received first frame");
        unsafe {
            SetWindowPos(
                window.0,
                None,
                10,
                10,
                480,
                360,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
            .unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let next = wait_frame(&mut capture);
            if next[..8] != first[..8] {
                break;
            }
            assert!(Instant::now() < deadline, "resize was not reflected");
        }
        eprintln!("Window test: resize reflected");
        drop(window);
        eprintln!("Window test: destroyed target");
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if capture.frame(720, &stop).is_err() {
                break;
            }
            assert!(Instant::now() < deadline, "closed window kept capturing");
        }
        eprintln!("Window test: close recognized");
    }
}

pub fn run(
    source: &Source,
    resolution: u32,
    frame_rate: u32,
    stop: &AtomicBool,
    requests: Receiver<FrameReply>,
    ready: tokio::sync::oneshot::Sender<Result<(), String>>,
) -> Result<(), String> {
    let init = (|| {
        let apartment = Apartment::new().map_err(|e| e.to_string())?;
        let mut capture = Capture::new(source).map_err(|e| {
            format!("Windows 原生采集无法启动（需要 Windows 10 1903+ 和可用显卡驱动）: {e}")
        })?;
        let deadline = Instant::now() + Duration::from_secs(8);
        let first = loop {
            let bytes = capture.frame(resolution, stop)?;
            if !bytes.is_empty() {
                break bytes;
            }
            if Instant::now() > deadline {
                return Err("未能获取屏幕画面，请还原目标窗口后重试".into());
            }
        };
        Ok::<_, String>((apartment, capture, first))
    })();
    let (_apartment, mut capture, first) = match init {
        Ok(value) => value,
        Err(e) => {
            let _ = ready.send(Err(e.clone()));
            return Err(e);
        }
    };
    if ready.send(Ok(())).is_err() {
        return Ok(());
    }
    let mut first = Some(first);
    let interval = Duration::from_secs_f64(1.0 / frame_rate as f64);
    let mut last = Instant::now() - interval;
    let mut last_request = Instant::now();
    while !stop.load(Ordering::Acquire) && !capture.closed.load(Ordering::Acquire) {
        match requests.recv_timeout(Duration::from_millis(100)) {
            Ok(reply) => {
                last_request = Instant::now();
                if reply.is_closed() {
                    continue;
                }
                if let Some(wait) = interval.checked_sub(last.elapsed()) {
                    std::thread::sleep(wait);
                }
                last = Instant::now();
                let result = if let Some(bytes) = first.take() {
                    Ok(bytes)
                } else {
                    capture.frame(resolution, stop)
                };
                let failed = result.is_err();
                let _ = reply.send(result);
                if failed {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            Err(_) => {
                if last_request.elapsed() > Duration::from_secs(12) {
                    break;
                }
            } // Renderer reload/crash cannot leave an orphan capture.
        }
    }
    Ok(())
}

// A fullscreen triangle scales in the GPU, avoiding CPU resize and an extra lossy codec.
const SHADER: &str = r#"
struct V { float4 p:SV_Position; float2 uv:TEXCOORD0; };
V vs(uint id:SV_VertexID) { V o; o.uv=float2((id<<1)&2,id&2); o.p=float4(o.uv*float2(2,-2)+float2(-1,1),0,1); return o; }
Texture2D image:register(t0); SamplerState linearClamp:register(s0);
float4 ps(V input):SV_Target { return float4(image.Sample(linearClamp,input.uv).rgb,1); }
"#;
struct Targets {
    input: ID3D11Texture2D,
    view: ID3D11ShaderResourceView,
    output: ID3D11Texture2D,
    target: ID3D11RenderTargetView,
    staging: ID3D11Texture2D,
    size: (u32, u32, u32, u32),
}
struct Scaler {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    vertex: ID3D11VertexShader,
    pixel: ID3D11PixelShader,
    sampler: ID3D11SamplerState,
    targets: Option<Targets>,
}
impl Scaler {
    unsafe fn new(
        device: ID3D11Device,
        context: ID3D11DeviceContext,
    ) -> windows::core::Result<Self> {
        let compile = |entry: PCSTR, model: PCSTR| -> windows::core::Result<Vec<u8>> {
            let mut blob = None;
            D3DCompile(
                SHADER.as_ptr() as _,
                SHADER.len(),
                None,
                None,
                None,
                entry,
                model,
                0,
                0,
                &mut blob,
                None,
            )?;
            let blob = blob.unwrap();
            Ok(std::slice::from_raw_parts(
                blob.GetBufferPointer() as *const u8,
                blob.GetBufferSize(),
            )
            .to_vec())
        };
        let mut vertex = None;
        let mut pixel = None;
        let mut sampler = None;
        device.CreateVertexShader(&compile(s!("vs"), s!("vs_4_0"))?, None, Some(&mut vertex))?;
        device.CreatePixelShader(&compile(s!("ps"), s!("ps_4_0"))?, None, Some(&mut pixel))?;
        device.CreateSamplerState(
            &D3D11_SAMPLER_DESC {
                Filter: D3D11_FILTER_MIN_MAG_MIP_LINEAR,
                AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
                MaxLOD: f32::MAX,
                ..Default::default()
            },
            Some(&mut sampler),
        )?;
        Ok(Self {
            device,
            context,
            vertex: vertex.unwrap(),
            pixel: pixel.unwrap(),
            sampler: sampler.unwrap(),
            targets: None,
        })
    }
    unsafe fn render(
        &mut self,
        texture: &ID3D11Texture2D,
        width: u32,
        height: u32,
    ) -> windows::core::Result<Vec<u8>> {
        let mut original = D3D11_TEXTURE2D_DESC::default();
        texture.GetDesc(&mut original);
        let size = (original.Width, original.Height, width, height);
        if self.targets.as_ref().map(|t| t.size) != Some(size) {
            let create = |desc: &D3D11_TEXTURE2D_DESC| -> windows::core::Result<ID3D11Texture2D> {
                let mut t = None;
                self.device.CreateTexture2D(desc, None, Some(&mut t))?;
                Ok(t.unwrap())
            };
            let input = create(&D3D11_TEXTURE2D_DESC {
                BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
                Usage: D3D11_USAGE_DEFAULT,
                CPUAccessFlags: 0,
                MiscFlags: 0,
                ..original
            })?;
            let mut view = None;
            self.device
                .CreateShaderResourceView(&input, None, Some(&mut view))?;
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_R8G8B8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
                ..Default::default()
            };
            let output = create(&desc)?;
            let mut target = None;
            self.device
                .CreateRenderTargetView(&output, None, Some(&mut target))?;
            let staging = create(&D3D11_TEXTURE2D_DESC {
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                ..desc
            })?;
            self.targets = Some(Targets {
                input,
                view: view.unwrap(),
                output,
                target: target.unwrap(),
                staging,
                size,
            });
        }
        let t = self.targets.as_ref().unwrap();
        self.context.CopyResource(&t.input, texture);
        self.context
            .OMSetRenderTargets(Some(&[Some(t.target.clone())]), None);
        self.context.RSSetViewports(Some(&[D3D11_VIEWPORT {
            Width: width as f32,
            Height: height as f32,
            MaxDepth: 1.0,
            ..Default::default()
        }]));
        self.context
            .IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        self.context.VSSetShader(&self.vertex, None);
        self.context.PSSetShader(&self.pixel, None);
        self.context
            .PSSetSamplers(0, Some(&[Some(self.sampler.clone())]));
        self.context
            .PSSetShaderResources(0, Some(&[Some(t.view.clone())]));
        self.context.Draw(3, 0);
        self.context.PSSetShaderResources(0, Some(&[None]));
        self.context.CopyResource(&t.staging, &t.output);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        self.context
            .Map(&t.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
        // Packet: little-endian width, height, then tightly packed RGBA8 rows.
        let row = width as usize * 4;
        let mut bytes = Vec::with_capacity(8 + row * height as usize);
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        for y in 0..height as usize {
            bytes.extend_from_slice(std::slice::from_raw_parts(
                (mapped.pData as *const u8).add(y * mapped.RowPitch as usize),
                row,
            ));
        }
        self.context.Unmap(&t.staging, 0);
        Ok(bytes)
    }
}
