import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './RestartConfirmModal.css';

interface RestartConfirmModalProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  enableGpu: boolean;
}

export const RestartConfirmModal: React.FC<RestartConfirmModalProps> = ({
  visible,
  onConfirm,
  onCancel,
  enableGpu,
}) => {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="restart-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onCancel}
        >
          {/* 弹窗内容 */}
          <motion.div
            className="restart-modal-container"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            onClick={(e) => e.stopPropagation()} // 阻止点击事件冒泡到overlay
          >
            <div className="restart-modal-content">
              {/* 图标 */}
              <div className="restart-modal-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="rgba(126,211,33,0.3)" strokeWidth="2" />
                  <path
                    d="M12 6v6l4 2"
                    stroke="rgba(126,211,33,0.9)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8 4.5A8 8 0 0 1 16 4.5"
                    stroke="rgba(126,211,33,0.9)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              {/* 标题 */}
              <h3 className="restart-modal-title">需要重启应用</h3>

              {/* 描述 */}
              <p className="restart-modal-description">
                GPU 渲染设置已{enableGpu ? '启用' : '禁用'}，需要重启 MCTier 才能生效
              </p>

              {/* 按钮组 */}
              <div className="restart-modal-buttons">
                <motion.button
                  className="restart-modal-btn restart-modal-btn-cancel"
                  onClick={onCancel}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <span>稍后重启</span>
                </motion.button>
                <motion.button
                  className="restart-modal-btn restart-modal-btn-confirm"
                  onClick={onConfirm}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 12a8 8 0 0 1 8-8V2.5L16 6l-4 3.5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-16 0z"
                      fill="currentColor"
                    />
                  </svg>
                  <span>立即重启</span>
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
