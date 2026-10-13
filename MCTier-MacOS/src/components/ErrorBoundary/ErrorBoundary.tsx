import { Component, ErrorInfo, ReactNode } from 'react';
import { Button, Result, Typography, Space } from 'antd';
import { tl } from '../../i18n';
import './ErrorBoundary.css';

const { Paragraph, Text } = Typography;

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

/**
 * 错误边界组件
 * 捕获子组件中的 JavaScript 错误并显示友好的错误界面
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private resetTimer: number | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('错误边界捕获到错误:', error, errorInfo);

    this.setState((prevState) => ({
      error,
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));

    // 调用外部错误处理回调
    if (this.props.onError) {
      try {
        this.props.onError(error, errorInfo);
      } catch (callbackError) {
        console.error('错误回调执行失败:', callbackError);
      }
    }

    // 记录错误日志
    this.logErrorToService(error, errorInfo);

    // 如果错误次数过多，不自动重置
    if (this.state.errorCount < 3) {
      // 5秒后自动尝试恢复
      this.resetTimer = window.setTimeout(() => {
        console.log('尝试自动恢复...');
        this.handleReset();
      }, 5000);
    }
  }

  componentWillUnmount(): void {
    // 清理定时器
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  logErrorToService(error: Error, errorInfo: ErrorInfo): void {
    // 实现错误日志上报逻辑
    const errorLog = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    console.log('错误日志:', errorLog);

    // 可以在这里添加错误上报到远程服务器的逻辑
    // 例如: sendErrorToServer(errorLog);
  }

  handleReset = (): void => {
    // 清理定时器
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = (): void => {
    // 清理定时器
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    window.location.reload();
  };

  handleClearStorage = (): void => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    } catch (error) {
      console.error('清理存储失败:', error);
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // 如果提供了自定义 fallback，使用它
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorCount } = this.state;
      const isCritical = errorCount >= 3;

      // 默认错误界面
      return (
        <div className="error-boundary-container">
          <Result
            status="error"
            title={isCritical ? tl('应用程序遇到严重错误', 'The application hit a critical error') : tl('应用程序遇到错误', 'The application hit an error')}
            subTitle={
              isCritical
                ? tl('应用程序多次遇到错误，建议清理缓存或重新安装。', 'The app has errored multiple times; consider clearing the cache or reinstalling.')
                : tl('抱歉，应用程序遇到了一个意外错误。您可以尝试重新加载或联系技术支持。', 'Sorry, the app encountered an unexpected error. You can try reloading or contact support.')
            }
            extra={
              <Space direction="vertical" size="middle">
                <Space>
                  <Button type="primary" onClick={this.handleReset}>
                    {tl('重试', 'Retry')}
                  </Button>
                  <Button onClick={this.handleReload}>{tl('重新加载应用', 'Reload App')}</Button>
                </Space>
                {isCritical && (
                  <Button danger onClick={this.handleClearStorage}>
                    {tl('清理缓存并重启', 'Clear Cache & Restart')}
                  </Button>
                )}
              </Space>
            }
          >
            <div className="error-details">
              <Paragraph>
                <Text strong>{tl('错误信息:', 'Error message:')}</Text>
              </Paragraph>
              <Paragraph>
                <Text code>{error?.message || tl('未知错误', 'Unknown error')}</Text>
              </Paragraph>

              {errorCount > 1 && (
                <Paragraph>
                  <Text type="warning">{tl('错误已发生', 'Error occurred')} {errorCount} {tl('次', 'time(s)')}</Text>
                </Paragraph>
              )}

              {import.meta.env.DEV && error?.stack && (
                <>
                  <Paragraph>
                    <Text strong>{tl('错误堆栈:', 'Error stack:')}</Text>
                  </Paragraph>
                  <Paragraph>
                    <pre className="error-stack">{error.stack}</pre>
                  </Paragraph>
                </>
              )}
            </div>
          </Result>
        </div>
      );
    }

    return this.props.children;
  }
}
