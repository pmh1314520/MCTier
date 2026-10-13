import { forwardRef, useState } from 'react';
import { Input } from 'antd';
import type { InputProps, InputRef } from 'antd';
import { tl } from '../../i18n';
import { avoidNativePasswordInput } from '../../utils/passwordInputPolicy';
import { nextProtectedEditValue, SAVED_PASSWORD_MASK } from '../../utils/protectedPasswordEdit';
import { LockIcon } from '../icons';
import { isProtectedPassword } from '../../security/lobbyPassword';
import './PasswordInput.css';

export type PasswordInputProps = Omit<InputProps, 'type'>;

/**
 * 跨平台密码输入框。
 *
 * Windows（WebView2）直接用 antd 的原生密码框，保留浏览器的密码语义。
 * Linux（WebKitGTK）下原生密码框会被 fcitx5 / ibus 的 GTK 输入法模块吞键，
 * 密码一个字都打不进去（issue #42 实机反馈），因此改用普通文本框 +
 * CSS `-webkit-text-security` 遮罩，从引擎层绕开这条冲突路径。
 *
 * 两条分支对外的 props 与受控行为完全一致，可直接替换 `Input.Password`，
 * 也能作为 `Form.Item` 的受控子组件使用。
 *
 * 值为受保护信封（本地保存/邀请回填的密码）时，输入框显示的是占位星号而非
 * 真实值——明文只在系统凭据库里，因此不提供"显示"，占位处换成"已保存"
 * 标记；任何编辑动作都原子地整字段替换（见 protectedPasswordEdit），避免
 * 占位星号与用户新输入混排（轻则串进星号，重则一次退格全清、感觉无法修改）。
 */
export const PasswordInput = forwardRef<InputRef, PasswordInputProps>((props, ref) => {
  const { className = '', autoComplete, spellCheck, ...rest } = props;
  const [revealed, setRevealed] = useState(false);
  const protectedValue = isProtectedPassword(rest.value);

  const emitValue = (value: string) => {
    // Form.Item 的 onChange 同时接受事件与普通值（自定义受控组件约定）。
    (rest.onChange as unknown as ((value: string) => void) | undefined)?.(value);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    (rest.onKeyDown as unknown as ((event: React.KeyboardEvent<HTMLInputElement>) => void) | undefined)?.(event);
    if (event.defaultPrevented || !protectedValue || event.nativeEvent.isComposing) return;
    const next = nextProtectedEditValue(event.key, event);
    if (next === null) return;
    event.preventDefault();
    emitValue(next);
  };
  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    (rest.onPaste as unknown as ((event: React.ClipboardEvent<HTMLInputElement>) => void) | undefined)?.(event);
    if (event.defaultPrevented || !protectedValue) return;
    const text = event.clipboardData.getData('text');
    event.preventDefault();
    emitValue(text);
  };
  const safeProps = {
    ...rest,
    value: protectedValue ? SAVED_PASSWORD_MASK : rest.value,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      if (protectedValue) event.target.value = event.target.value.replace(/\*/g, '');
      rest.onChange?.(event);
    },
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
  };

  // 平台判定只做一次：同一进程内 User-Agent 不会变。
  const [maskWithCss] = useState(avoidNativePasswordInput);

  const savedBadge = protectedValue ? (
    <span
      className="mctier-password-saved-badge"
      title={tl('已使用保存的密码；直接输入即可替换', 'Saved password in use; type to replace it')}
      aria-label={tl('已使用保存的密码', 'Saved password in use')}
      role="img"
    >
      <LockIcon open={false} size={15} />
    </span>
  ) : null;

  if (!maskWithCss) {
    return (
      <Input.Password
        ref={ref}
        className={className}
        autoComplete={autoComplete ?? 'new-password'}
        spellCheck={spellCheck ?? false}
        {...safeProps}
        visibilityToggle={protectedValue ? false : { visible: revealed, onVisibleChange: setRevealed }}
        suffix={savedBadge}
      />
    );
  }

  const maskedClassName = [
    'mctier-masked-password',
    revealed && !protectedValue ? 'mctier-masked-password-revealed' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Input
      ref={ref}
      type="text"
      className={maskedClassName}
      // 文本框不会被浏览器当成密码框，必须显式关掉自动填充与拼写检查，
      // 否则密码可能被记录进历史或候选词。
      autoComplete={autoComplete ?? 'off'}
      spellCheck={spellCheck ?? false}
      autoCorrect="off"
      autoCapitalize="off"
      data-mctier-masked="true"
      suffix={
        savedBadge ?? (
          <button
            type="button"
            className="mctier-masked-password-toggle"
            aria-label={revealed ? tl('隐藏密码', 'Hide password') : tl('显示密码', 'Show password')}
            aria-pressed={revealed}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setRevealed((value) => !value)}
          >
            <LockIcon open={revealed} size={15} />
          </button>
        )
      }
      {...safeProps}
    />
  );
});

PasswordInput.displayName = 'PasswordInput';
