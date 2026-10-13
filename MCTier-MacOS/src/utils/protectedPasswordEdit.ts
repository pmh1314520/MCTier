/**
 * 受保护密码（凭据库信封 mctier-local-v1 / mctier-invite-v3）在输入框里的编辑语义。
 *
 * 信封的明文只在系统凭据库里能还原，输入框里显示的 `SAVED_PASSWORD_MASK`
 * 只是"已保存"占位——它不是真实值。因此编辑不能按普通文本处理（把占位
 * 星号和新输入混在一起，轻则星号被当作用户输入，重则一次退格清空全部），
 * 而是整个字段原子替换：首个可打印键替换为该字符，退格/删除清空。
 * 修饰键组合与导航键放行给浏览器。
 */

/** 受保护密码在输入框里的占位显示。 */
export const SAVED_PASSWORD_MASK = '********';

/**
 * 计算受保护占位值上的按键编辑结果。
 *
 * 返回 string 表示拦截默认行为并整体替换为该值；返回 null 表示不拦截。
 * `isComposing` 由调用方判断（IME 组合中的按键不在此处理）。
 */
export function nextProtectedEditValue(
  key: string,
  modifiers: { altKey: boolean; ctrlKey: boolean; metaKey: boolean },
): string | null {
  if (modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey) return null;
  if (key.length === 1) return key;
  if (key === 'Backspace' || key === 'Delete') return '';
  return null;
}
