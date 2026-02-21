use std::fmt;
use std::future::Future;
use std::time::Duration;

/// 统一的应用错误类型
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// 输入验证错误
    #[error("输入验证失败: {0}")]
    ValidationError(String),

    /// 网络相关错误
    #[error("网络错误: {0}")]
    NetworkError(String),

    /// 音频设备错误
    #[error("音频设备错误: {0}")]
    AudioError(String),

    /// 语音服务错误
    #[error("语音服务错误: {0}")]
    VoiceError(String),

    /// 配置文件错误
    #[error("配置错误: {0}")]
    ConfigError(String),

    /// 进程管理错误
    #[error("进程错误: {0}")]
    ProcessError(String),

    /// IO 错误
    #[error("IO 错误: {0}")]
    IoError(String),

    /// 文件操作错误
    #[error("文件错误: {0}")]
    FileError(String),

    /// 序列化/反序列化错误
    #[error("序列化错误: {0}")]
    SerializationError(String),

    /// 未知错误
    #[error("未知错误: {0}")]
    Unknown(String),
}

/// 从 std::io::Error 转换
impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::IoError(err.to_string())
    }
}

/// 从 serde_json::Error 转换
impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::SerializationError(err.to_string())
    }
}

/// 错误日志记录函数
pub fn log_error(error: &AppError, context: &str) {
    log::error!("[{}] 错误: {}", context, error);
}

/// 错误日志记录函数（带详细信息）
pub fn log_error_with_details(error: &AppError, context: &str, details: &str) {
    log::error!("[{}] 错误: {} - 详情: {}", context, error, details);
}

/// 异步重试机制
/// 
/// # 参数
/// * `operation` - 要执行的异步操作
/// * `max_retries` - 最大重试次数
/// * `delay_ms` - 每次重试之间的延迟（毫秒）
/// 
/// # 返回
/// * `Ok(T)` - 操作成功返回结果
/// * `Err(E)` - 所有重试都失败后返回最后一次的错误
/// 
/// # 示例
/// ```rust
/// let result = with_retry(
///     || Box::pin(async { some_async_operation().await }),
///     3,
///     1000
/// ).await;
/// ```
pub async fn with_retry<F, Fut, T, E>(
    mut operation: F,
    max_retries: u32,
    delay_ms: u64,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: fmt::Display,
{
    let mut attempts = 0;
    
    loop {
        match operation().await {
            Ok(result) => {
                if attempts > 0 {
                    log::info!("操作在第 {} 次尝试后成功", attempts + 1);
                }
                return Ok(result);
            }
            Err(e) => {
                attempts += 1;
                
                if attempts > max_retries {
                    log::error!("操作失败，已达到最大重试次数 {}: {}", max_retries, e);
                    return Err(e);
                }
                
                log::warn!(
                    "操作失败，正在重试 {}/{}: {}",
                    attempts,
                    max_retries,
                    e
                );
                
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
        }
    }
}

/// 异步重试机制（带指数退避）
/// 
/// # 参数
/// * `operation` - 要执行的异步操作
/// * `max_retries` - 最大重试次数
/// * `initial_delay_ms` - 初始延迟（毫秒）
/// 
/// # 返回
/// * `Ok(T)` - 操作成功返回结果
/// * `Err(E)` - 所有重试都失败后返回最后一次的错误
/// 
/// # 说明
/// 每次重试的延迟时间会翻倍（指数退避），例如：
/// - 第1次重试: initial_delay_ms
/// - 第2次重试: initial_delay_ms * 2
/// - 第3次重试: initial_delay_ms * 4
pub async fn with_retry_exponential_backoff<F, Fut, T, E>(
    mut operation: F,
    max_retries: u32,
    initial_delay_ms: u64,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: fmt::Display,
{
    let mut attempts = 0;
    let mut delay = initial_delay_ms;
    
    loop {
        match operation().await {
            Ok(result) => {
                if attempts > 0 {
                    log::info!("操作在第 {} 次尝试后成功", attempts + 1);
                }
                return Ok(result);
            }
            Err(e) => {
                attempts += 1;
                
                if attempts > max_retries {
                    log::error!("操作失败，已达到最大重试次数 {}: {}", max_retries, e);
                    return Err(e);
                }
                
                log::warn!(
                    "操作失败，正在重试 {}/{}（延迟 {}ms）: {}",
                    attempts,
                    max_retries,
                    delay,
                    e
                );
                
                tokio::time::sleep(Duration::from_millis(delay)).await;
                
                // 指数退避：每次延迟时间翻倍
                delay *= 2;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = AppError::ValidationError("测试错误".to_string());
        assert_eq!(err.to_string(), "输入验证失败: 测试错误");
    }

    #[test]
    fn test_io_error_conversion() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "文件未找到");
        let app_err: AppError = io_err.into();
        
        match app_err {
            AppError::IoError(msg) => assert!(msg.contains("文件未找到")),
            _ => panic!("错误类型转换失败"),
        }
    }

    #[test]
    fn test_json_error_conversion() {
        let json_str = "{invalid json}";
        let json_err = serde_json::from_str::<serde_json::Value>(json_str).unwrap_err();
        let app_err: AppError = json_err.into();
        
        match app_err {
            AppError::SerializationError(_) => {},
            _ => panic!("错误类型转换失败"),
        }
    }

    #[tokio::test]
    async fn test_with_retry_success_first_attempt() {
        let mut call_count = 0;
        
        let result = with_retry(
            || {
                call_count += 1;
                Box::pin(async { Ok::<i32, String>(42) })
            },
            3,
            100,
        )
        .await;
        
        assert_eq!(result, Ok(42));
        assert_eq!(call_count, 1);
    }

    #[tokio::test]
    async fn test_with_retry_success_after_retries() {
        let mut call_count = 0;
        
        let result = with_retry(
            || {
                call_count += 1;
                Box::pin(async move {
                    if call_count < 3 {
                        Err("临时错误".to_string())
                    } else {
                        Ok(42)
                    }
                })
            },
            3,
            10,
        )
        .await;
        
        assert_eq!(result, Ok(42));
        assert_eq!(call_count, 3);
    }

    #[tokio::test]
    async fn test_with_retry_failure_after_max_retries() {
        let mut call_count = 0;
        
        let result = with_retry(
            || {
                call_count += 1;
                Box::pin(async { Err::<i32, String>("持续错误".to_string()) })
            },
            3,
            10,
        )
        .await;
        
        assert!(result.is_err());
        assert_eq!(call_count, 4); // 初始尝试 + 3次重试
    }

    #[tokio::test]
    async fn test_with_retry_exponential_backoff() {
        let mut call_count = 0;
        let start = std::time::Instant::now();
        
        let result = with_retry_exponential_backoff(
            || {
                call_count += 1;
                Box::pin(async move {
                    if call_count < 3 {
                        Err("临时错误".to_string())
                    } else {
                        Ok(42)
                    }
                })
            },
            3,
            10,
        )
        .await;
        
        let elapsed = start.elapsed();
        
        assert_eq!(result, Ok(42));
        assert_eq!(call_count, 3);
        // 第1次重试: 10ms, 第2次重试: 20ms, 总共至少 30ms
        assert!(elapsed.as_millis() >= 30);
    }
}
