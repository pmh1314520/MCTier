/**
 * 全局按钮语义着色
 * - 自动识别"取消 / 关闭 / 退出"这类否定/退出按钮，统一标记为红色（mct-cancel-btn）。
 * - 其余次要按钮保持绿色调（见 App.css），危险按钮保持红色。
 * 通过 MutationObserver 覆盖动态渲染的弹窗按钮，无需逐个改造。
 */

import { useEffect } from 'react';

const CANCEL_KEYWORDS = ['取消', '关闭', '退出'];

export const GlobalButtonTheme: React.FC = () => {
  useEffect(() => {
    const tagButtons = () => {
      const btns = document.querySelectorAll<HTMLButtonElement>('button.ant-btn');
      btns.forEach((btn) => {
        const txt = (btn.textContent || '').trim();
        // 文本包含"取消/关闭/退出"任一关键词即视为否定/退出按钮
        const isCancel = txt.length > 0 && CANCEL_KEYWORDS.some((w) => txt.includes(w));
        if (isCancel) {
          if (!btn.classList.contains('mct-cancel-btn')) btn.classList.add('mct-cancel-btn');
        } else if (btn.classList.contains('mct-cancel-btn')) {
          btn.classList.remove('mct-cancel-btn');
        }
      });
    };

    // 初次执行
    tagButtons();

    // 用 rAF 去抖，避免频繁触发
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        tagButtons();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
};
