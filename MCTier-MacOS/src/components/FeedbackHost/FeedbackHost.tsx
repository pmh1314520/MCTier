import React, { useEffect, useState } from 'react';
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from '@ant-design/icons';
import { createPortal } from 'react-dom';
import { subscribeFeedback, type FeedbackDetail } from '../../services/ui/feedback';
import './FeedbackHost.css';

const iconFor = (kind: FeedbackDetail['kind']) => {
  if (kind === 'success') return <CheckCircleFilled />;
  if (kind === 'warning') return <ExclamationCircleFilled />;
  if (kind === 'error') return <CloseCircleFilled />;
  return <InfoCircleFilled />;
};

export const FeedbackHost: React.FC = () => {
  const [items, setItems] = useState<FeedbackDetail[]>([]);
  useEffect(() => subscribeFeedback((detail) => {
    setItems((current) => [...current.slice(-2), detail]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== detail.id)), 3600);
  }), []);

  return createPortal(<div className="mctier-feedback-host" role="region" aria-live="polite">
    {items.map((item) => <div key={item.id} className={`mctier-feedback mctier-feedback-${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}>
      {iconFor(item.kind)}<span>{item.text}</span>
    </div>)}
  </div>, document.body);
};
