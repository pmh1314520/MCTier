import { useEffect, useRef, useState } from 'react';
import { Button, Modal, QRCode, Segmented } from 'antd';
import { quarkSupport, useQuarkSupport } from '../../services/quarkSupport';
import { tl } from '../../i18n';
import './QuarkSupport.css';
import { QuarkMobileLogin } from './QuarkMobileLogin';

export function QuarkSupport() {
  const state = useQuarkSupport();
  const [loginMethod, setLoginMethod] = useState<'qr' | 'mobile'>('qr');
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(0);
  const active = useRef(true);
  const login = useRef<string | null>(null);
  login.current = state.loginId;
  useEffect(() => {
    const deadline = Date.now() + state.expiresIn * 1000;
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [state.expiresIn, state.loginId]);
  useEffect(() => {
    active.current = true;
    void quarkSupport('verify').catch(() =>
      setError(
        tl(
          '暂时无法验证夸克登录，请检查网络后重试',
          'Cannot verify Quark login. Check your connection and retry.'
        )
      )
    );
    return () => {
      active.current = false;
      if (login.current) void quarkSupport('cancel', login.current).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!state.loginId || state.loginMethod !== 'qr') return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await quarkSupport('poll', state.loginId);
        failures = 0;
        if (!cancelled) setError('');
      } catch (e) {
        failures++;
        if (!cancelled) setError(String(e));
      }
      if (!cancelled) timer = setTimeout(poll, Math.min(30000, 2500 * 2 ** failures));
    };
    timer = setTimeout(poll, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.loginId, state.loginMethod]);
  useEffect(() => {
    if (!state.loggedIn) return;
    const timer = setInterval(() => void quarkSupport('status').catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [state.loggedIn]);
  const run = async (action: Parameters<typeof quarkSupport>[0]) => {
    setBusy(true);
    setError('');
    try {
      const next = await quarkSupport(action);
      if (!active.current && next.loginId) await quarkSupport('cancel', next.loginId);
    } catch (e) {
      if (active.current) setError(String(e));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const changeLoginMethod = async (method: 'qr' | 'mobile') => {
    setBusy(true);
    setError('');
    try {
      if (state.loginId) await quarkSupport('cancel', state.loginId);
      if (active.current) setLoginMethod(method);
    } catch (e) {
      if (active.current) setError(String(e));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <section className="quark-support" aria-label={tl('夸克赞助', 'Quark support')}>
      <header className="quark-hero">
        <span className="quark-hero-icon">
          <SupportHeart />
        </span>
        <div className="quark-eyebrow">MCTier × {tl('夸克网盘', 'Quark Drive')}</div>
        <h2>{tl('夸克替您，持续赞助', 'Keep supporting MCTier through Quark')}</h2>
        <p>
          {tl(
            '登录一次，之后每天自动转存支持开发。',
            'Sign in once. Daily saves then run automatically.'
          )}
        </p>
      </header>
      <div className="quark-layout">
        <div className="quark-overview">
          <div className="quark-panel quark-impact">
            <h3>
              {state.loggedIn
                ? tl('您的支持记录', 'Your contribution')
                : tl('您的支持，能带来什么', 'What your support makes possible')}
            </h3>
            {state.loggedIn ? (
              <>
                <div className="quark-metrics" aria-live="polite">
                  <div>
                    <span>{tl('累计支持', 'Recorded days')}</span>
                    <strong>
                      {state.stats.successDays}
                      <small>{tl(' 天', ' days')}</small>
                    </strong>
                  </div>
                  <div>
                    <span>{tl('等价赞助', 'Equivalent support')}</span>
                    <strong className="quark-money">
                      ¥{(state.stats.successDays * 22 / 100).toFixed(2)}
                    </strong>
                  </div>
                </div>
                <p className="quark-caption">
                  {tl(
                    '仅统计本机确认成功的转存日期。',
                    'Confirmed save dates on this device only.'
                  )}
                </p>
                {state.stats.firstDay && (
                  <div className="quark-dates">
                    <span>
                      {tl('首次支持', 'First save')}
                      <b>{state.stats.firstDay}</b>
                    </span>
                    <span>
                      {tl('最近支持', 'Latest save')}
                      <b>{state.stats.lastDay}</b>
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="quark-rate">
                  <strong>{tl('等价赞助', 'Equivalent support')}</strong>
                  <span>
                    {tl(
                      '登录后按累计支持天数计算具体金额',
                      'Sign in to calculate the exact amount from recorded support days'
                    )}
                  </span>
                </div>
                <p className="quark-caption">
                  {tl(
                    '夸克提供推广收入，用于支持 MCTier 的维护与开发，您无需付款。',
                    'Quark referral income helps maintain and develop MCTier. No payment is needed.'
                  )}
                </p>
              </>
            )}
            <div className="quark-pills">
              <span>{tl('自愿参与', 'Optional')}</span>
              <span>{tl('无需付款', 'No payment')}</span>
              <span>{tl('随时退出', 'Leave anytime')}</span>
            </div>
          </div>
          <div className="quark-flow" aria-label={tl('参与步骤', 'How it works')}>
            <span>
              <b>01</b>
              {tl('登录账号', 'Sign in')}
            </span>
            <i aria-hidden="true">→</i>
            <span>
              <b>02</b>
              {tl('每日自动转存', 'Automatic daily save')}
            </span>
            <i aria-hidden="true">→</i>
            <span>
              <b>03</b>
              {tl('记录支持', 'Track support')}
            </span>
          </div>
        </div>
        <div className="quark-panel quark-account">
          <div className="quark-section-heading">
            <h3>
              {state.loggedIn
                ? tl('已连接夸克', 'Quark connected')
                : tl('连接您的夸克账号', 'Connect your Quark account')}
            </h3>
            <span className={`quark-status ${state.loggedIn ? 'is-connected' : ''}`}>
              {state.loggedIn ? tl('已登录', 'Signed in') : tl('未登录', 'Not connected')}
            </span>
          </div>
          {state.loggedIn ? (
            <>
              <strong className="quark-account-name">
                {state.name || tl('夸克用户', 'Quark user')}
              </strong>
              <p className="quark-feedback" role="status">
                {tl(
                  '每日自动转存已开启，无需手动操作。',
                  'Automatic daily saves are on. No manual action needed.'
                )}
              </p>
              <Button block type="text" disabled={busy} onClick={() => void run('logout')}>
                {tl('退出登录 / 更换账号', 'Sign out / Switch account')}
              </Button>
              <p className="quark-caption">
                {tl(
                  '退出会停止自动转存并删除本机登录凭据，保留支持记录和已转存文件。',
                  'Signing out stops daily saves, removes local credentials, and keeps your records and saved files.'
                )}
              </p>
            </>
          ) : (
            <>
              <Segmented
                block
                value={loginMethod}
                disabled={busy}
                options={[
                  { label: tl('扫码登录', 'QR code'), value: 'qr' },
                  { label: tl('手机号登录', 'Phone / SMS'), value: 'mobile' },
                ]}
                onChange={(value) => void changeLoginMethod(value as 'qr' | 'mobile')}
              />
              {loginMethod === 'mobile' ? (
                state.loginMethod === 'mobile' && state.loginId && remaining > 0 ? (
                  <QuarkMobileLogin key={state.loginId} loginId={state.loginId} />
                ) : (
                  <p className="quark-caption">
                    {state.loginMethod === 'mobile'
                      ? tl(
                          '登录页面已过期，请重新打开。',
                          'Sign-in expired. Please reopen the form.'
                        )
                      : tl(
                          '使用手机号和短信验证码登录，无需安装夸克 App。',
                          'Use your phone number and SMS code. No Quark app needed.'
                        )}
                  </p>
                )
              ) : state.qrUrl ? (
                <div className="quark-qr">
                  <QRCode
                    value={state.qrUrl}
                    status={remaining > 0 ? 'active' : 'expired'}
                    onRefresh={() => {
                      if (!busy) void run('login');
                    }}
                    size={176}
                    bgColor="#fff"
                    color="#111"
                  />
                  <span>
                    {remaining > 0
                      ? tl(
                          `请用夸克扫码 · ${remaining}s 后自动更新`,
                          `Scan with Quark · refreshes in ${remaining}s`
                        )
                      : tl('二维码已过期，正在尝试更新', 'QR expired. Refreshing…')}
                  </span>
                </div>
              ) : (
                <div className="quark-login-intro">
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="6" height="6" rx="1" />
                    <rect x="15" y="3" width="6" height="6" rx="1" />
                    <rect x="3" y="15" width="6" height="6" rx="1" />
                    <path d="M15 15h3v3h3v3h-6z" />
                  </svg>
                  <span>{tl('使用夸克 App 扫码确认', 'Scan and confirm in the Quark app')}</span>
                </div>
              )}
              <Button
                block
                type="primary"
                loading={busy}
                onClick={() => void run(loginMethod === 'mobile' ? 'mobile_login' : 'login')}
              >
                {loginMethod === 'mobile'
                  ? state.loginMethod === 'mobile'
                    ? tl('重新打开手机号登录', 'Reopen phone sign-in')
                    : tl('开始手机号登录', 'Start phone sign-in')
                  : state.qrUrl
                    ? tl('刷新二维码', 'Refresh QR code')
                    : tl('获取登录二维码', 'Get sign-in QR code')}
              </Button>
            </>
          )}
          {state.result && (
            <p role="status" className="quark-feedback">
              {state.result.replace(/你/g, '您')}
            </p>
          )}
          {error && (
            <p role="alert" className="quark-error">
              {error}
            </p>
          )}
          {state.backgroundError && (
            <p role="alert" className="quark-error">
              {tl(
                '自动转存配置暂未完成，将自动重试。',
                'Automatic save setup is incomplete and will retry automatically.'
              )}
            </p>
          )}
          {error && !state.loggedIn && (
            <Button disabled={busy} onClick={() => void run('logout')}>
              {tl('清除本机登录数据', 'Clear local login data')}
            </Button>
          )}
        </div>
      </div>
      <div className="quark-rule-section">
        <button
          className="quark-rule-toggle"
          aria-expanded={showRules}
          aria-controls="quark-support-rules"
          onClick={() => setShowRules(!showRules)}
        >
          <span>{tl('收益参考', 'Reference rates')}</span>
          <span aria-hidden="true">{showRules ? '−' : '+'}</span>
        </button>
        {showRules && (
          <div id="quark-support-rules" className="quark-rules">
            <table aria-label={tl('有效转存收益参考', 'Eligible save reference rates')}>
              <thead>
                <tr>
                  <th scope="col">{tl('有效转存渠道', 'Eligible save channel')}</th>
                  <th scope="col">
                    {tl('开发者参考收益 / 次', 'Developer reference income / save')}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{tl('手机端', 'Mobile')}</th>
                  <td>¥0.47</td>
                </tr>
                <tr>
                  <th scope="row">{tl('电脑端', 'Desktop')}</th>
                  <td>¥0.22</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      <footer className="quark-footer">
        {tl(
          '自愿参与，不参与也能使用全部功能。',
          'Participation is optional. All features remain available.'
        )}
      </footer>
    </section>
  );
}

function SupportHeart() {
  return (
    <svg
      className="quark-heart"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

export function QuarkSupportEntry({ onClick }: { onClick: () => void }) {
  const state = useQuarkSupport();
  return (
    <button
      type="button"
      className={`quark-entry ${!state.loggedIn ? 'quark-entry-inviting' : ''}`}
      onClick={onClick}
      aria-label={tl('夸克赞助', 'Quark support')}
      title={tl('夸克赞助 · 支持 MCTier 开发', 'Quark support · Help MCTier grow')}
    >
      <SupportHeart />
    </button>
  );
}

export function QuarkSupportWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={tl('支持 MCTier', 'Support MCTier')}
      centered
      width={720}
      className="quark-modal"
      destroyOnClose
      maskClosable={false}
    >
      {open && <QuarkSupport />}
    </Modal>
  );
}
