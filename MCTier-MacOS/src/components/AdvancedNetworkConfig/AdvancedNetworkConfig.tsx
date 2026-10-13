import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Input, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import './AdvancedNetworkConfig.css';

export interface NetworkConfig {
  virtualDomain?: string;
}

interface AdvancedNetworkConfigProps {
  value?: NetworkConfig;
  onChange?: (config: NetworkConfig) => void;
}

export const AdvancedNetworkConfig: React.FC<AdvancedNetworkConfigProps> = ({
  value = {},
  onChange,
}) => {
  useTranslation();
  const [virtualDomain, setVirtualDomain] = useState(value.virtualDomain || '');

  const handleVirtualDomainChange = (value: string) => {
    setVirtualDomain(value);
    onChange?.({ virtualDomain: value });
  };

  return (
    <div className="advanced-network-config">
      <motion.div
        className="config-section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="section-header">
          <h4>{tl('虚拟域名', 'Virtual Domain')}</h4>
          <Tooltip title={tl('为虚拟网络配置自定义域名', 'Configure a custom domain for the virtual network')}>
            <QuestionCircleOutlined />
          </Tooltip>
        </div>
        
        <Input
          placeholder={tl('例如: mctier.local', 'e.g. mctier.local')}
          value={virtualDomain}
          onChange={(e) => handleVirtualDomainChange(e.target.value)}
          maxLength={50}
        />
        
        {virtualDomain && (
          <div className="domain-preview">
            <span className="preview-label">{tl('预览:', 'Preview:')}</span>
            <span className="preview-value">{virtualDomain}</span>
          </div>
        )}
      </motion.div>
    </div>
  );
};
