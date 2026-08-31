import { forwardRef, useState } from 'react';
import { Input } from 'antd';
import type { InputProps, InputRef } from 'antd';
import { tl } from '../../i18n';
import { avoidNativePasswordInput } from '../../utils/passwordInputPolicy';
import { LockIcon } from '../icons';
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
 */
export const PasswordInput = forwardRef<InputRef, PasswordInputProps>((props, ref) => {
  const { className = '', autoComplete, spellCheck, ...rest } = props;
  const [revealed, setRevealed] = useState(false);

  // 平台判定只做一次：同一进程内 User-Agent 不会变。
  const [maskWithCss] = useState(avoidNativePasswordInput);

  if (!maskWithCss) {
    return (
      <Input.Password
        ref={ref}
        className={className}
        autoComplete={autoComplete ?? 'new-password'}
        spellCheck={spellCheck ?? false}
        {...rest}
      />
    );
  }

  const maskedClassName = [
    'mctier-masked-password',
    revealed ? 'mctier-masked-password-revealed' : '',
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
      }
      {...rest}
    />
  );
});

PasswordInput.displayName = 'PasswordInput';
