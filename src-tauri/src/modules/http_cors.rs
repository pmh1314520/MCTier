/**
 * 局域网 HTTP 服务的 CORS 策略
 * 文件共享（14539）与 P2P 聊天（14540）两个服务共用。
 *
 * 这两个服务监听在 EasyTier 虚拟网卡上，同一大厅内的任意节点都能访问，
 * 因此不能使用 CorsLayer::permissive()：那会让任意网页（包括虚拟网内其他节点
 * 打开的恶意页面）在浏览器里读取本机的共享文件列表与聊天内容。
 *
 * 这里改为显式的来源白名单，只放行 MCTier 自己的 WebView 来源。
 * Android 客户端使用 OkHttp 原生请求，不发送 Origin 头，不受 CORS 限制，
 * 因此收紧策略不会影响 Android 端互通。
 */
use axum::http::{header, HeaderValue, Method};
use tower_http::cors::{AllowOrigin, CorsLayer};

/// MCTier WebView 的合法来源。
///
/// - Windows / Android：`http(s)://tauri.localhost`
/// - macOS / Linux：`tauri://localhost`
/// - `http://localhost:1420`：仅 `npm run tauri dev` 时的 Vite 开发服务器
const ALLOWED_ORIGINS: &[&str] = &[
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
    "http://localhost:1420",
];

/// 构造局域网 HTTP 服务统一使用的 CORS 层。
pub fn lan_cors_layer() -> CorsLayer {
    let origins: Vec<HeaderValue> = ALLOWED_ORIGINS
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::RANGE,
            header::HeaderName::from_static("x-share-password"),
            header::HeaderName::from_static("x-mctier-chat-token"),
            // 聊天请求签名材料：缺一个都会让签名校验失败，
            // 因此必须与令牌头一起列入白名单。
            header::HeaderName::from_static("x-mctier-chat-key"),
            header::HeaderName::from_static("x-mctier-chat-sig"),
            header::HeaderName::from_static("x-mctier-chat-ts"),
            header::HeaderName::from_static("x-mctier-chat-nonce"),
        ])
        .expose_headers([
            header::CONTENT_LENGTH,
            header::CONTENT_DISPOSITION,
            header::CONTENT_RANGE,
            header::ACCEPT_RANGES,
        ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    fn app() -> Router {
        Router::new()
            .route("/api/shares", get(|| async { "ok" }))
            .layer(lan_cors_layer())
    }

    async fn allow_origin_of(origin: Option<&str>) -> Option<String> {
        let mut req = Request::builder().uri("/api/shares").method("GET");
        if let Some(value) = origin {
            req = req.header("origin", value);
        }
        let res = app()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        res.headers()
            .get("access-control-allow-origin")
            .map(|v| v.to_str().unwrap().to_string())
    }

    #[tokio::test]
    async fn allows_mctier_webview_origins() {
        for origin in ALLOWED_ORIGINS {
            assert_eq!(
                allow_origin_of(Some(origin)).await.as_deref(),
                Some(*origin),
                "白名单来源 {} 应被放行",
                origin
            );
        }
    }

    #[tokio::test]
    async fn rejects_origins_from_the_virtual_network() {
        // 虚拟网内其他节点打开的页面、以及任意外部站点都不得读取本机数据
        for origin in [
            "http://evil.example",
            "http://10.126.126.9",
            "http://10.126.126.9:14539",
            "null",
        ] {
            assert_eq!(
                allow_origin_of(Some(origin)).await,
                None,
                "非白名单来源 {} 不得收到 CORS 放行头",
                origin
            );
        }
    }

    #[tokio::test]
    async fn never_returns_wildcard_origin() {
        assert_ne!(
            allow_origin_of(Some("http://tauri.localhost"))
                .await
                .as_deref(),
            Some("*"),
            "不得回写通配符来源，否则等同于 permissive"
        );
    }

    #[tokio::test]
    async fn native_clients_without_origin_are_unaffected() {
        // Android OkHttp / reqwest 不发送 Origin，收紧 CORS 不能影响跨端互通
        let res = app()
            .oneshot(
                Request::builder()
                    .uri("/api/shares")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 200, "原生客户端请求不应被 CORS 拦截");
    }

    #[tokio::test]
    async fn preflight_allows_the_share_password_header() {
        let res = app()
            .oneshot(
                Request::builder()
                    .uri("/api/shares")
                    .method("OPTIONS")
                    .header("origin", "http://tauri.localhost")
                    .header("access-control-request-method", "GET")
                    .header("access-control-request-headers", "x-share-password")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let allowed = res
            .headers()
            .get("access-control-allow-headers")
            .expect("预检必须返回 allow-headers")
            .to_str()
            .unwrap()
            .to_lowercase();
        assert!(
            allowed.contains("x-share-password"),
            "预检必须放行 x-share-password，否则带密码的共享会下载失败：{}",
            allowed
        );
    }

    #[tokio::test]
    async fn actual_response_exposes_download_headers() {
        let res = app()
            .oneshot(
                Request::builder()
                    .uri("/api/shares")
                    .method("GET")
                    .header("origin", "http://tauri.localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let exposed = res
            .headers()
            .get("access-control-expose-headers")
            .expect("实际响应应带 expose-headers，否则前端读不到 Content-Length")
            .to_str()
            .unwrap()
            .to_lowercase();
        for header_name in [
            "content-length",
            "content-disposition",
            "content-range",
            "accept-ranges",
        ] {
            assert!(
                exposed.contains(header_name),
                "应暴露 {}：{}",
                header_name,
                exposed
            );
        }
    }

    #[test]
    fn allowlist_never_contains_a_wildcard() {
        assert!(
            !ALLOWED_ORIGINS.contains(&"*"),
            "白名单不得包含通配符，否则等同于 permissive"
        );
    }

    #[test]
    fn all_allowed_origins_are_valid_header_values() {
        for origin in ALLOWED_ORIGINS {
            assert!(
                HeaderValue::from_str(origin).is_ok(),
                "来源 {} 无法作为 HeaderValue，CORS 白名单会静默丢掉它",
                origin
            );
        }
    }
}
