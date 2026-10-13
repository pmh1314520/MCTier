import { useEffect, useRef, useState } from 'react';
import { quarkSupport } from '../../services/quarkSupport';
import { QUARK_MOBILE_URL, quarkMobileTicket } from '../../services/quarkMobileLogin';
import { tl } from '../../i18n';

export function QuarkMobileLogin({ loginId }: { loginId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let pending = false;
    const receive = async (event: MessageEvent) => {
      const ticket = quarkMobileTicket(event, frame.current?.contentWindow ?? null);
      if (!ticket || pending) return;
      pending = true;
      setBusy(true);
      setError('');
      try {
        await quarkSupport('mobile_complete', loginId, ticket);
      } catch (e) {
        if (active) {
          pending = false;
          setError(String(e));
        }
      } finally {
        if (active) setBusy(false);
      }
    };
    window.addEventListener('message', receive);
    return () => {
      active = false;
      window.removeEventListener('message', receive);
    };
  }, [loginId]);
  return (
    <div className="quark-mobile-login">
      <p className="quark-caption">
        {tl(
          '输入手机号和短信验证码即可登录，无需安装夸克 App。',
          'Sign in with your phone number and SMS code. No Quark app needed.'
        )}
      </p>
      <iframe
        ref={frame}
        src={QUARK_MOBILE_URL}
        title={tl('夸克手机号验证码登录', 'Quark phone and SMS sign-in')}
        sandbox="allow-scripts allow-forms allow-same-origin"
        referrerPolicy="no-referrer"
      />
      {busy && <p role="status">{tl('正在完成登录…', 'Completing sign-in…')}</p>}
      {error && (
        <p role="alert" className="quark-error">
          {error}
        </p>
      )}
    </div>
  );
}
