import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Input, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
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
          <h4>虚拟域名</h4>
          <Tooltip title="为虚拟网络配置自定义域名">
            <QuestionCircleOutlined />
          </Tooltip>
        </div>
        
        <Input
          placeholder="例如: mctier.local"
          value={virtualDomain}
          onChange={(e) => handleVirtualDomainChange(e.target.value)}
          maxLength={50}
        />
        
        {virtualDomain && (
          <div className="domain-preview">
            <span className="preview-label">预览:</span>
            <span className="preview-value">{virtualDomain}</span>
          </div>
        )}
      </motion.div>
    </div>
  );
};
