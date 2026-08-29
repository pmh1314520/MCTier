import React, { useRef } from 'react';
import { tl } from '../../i18n';
import './SettingsAvatarPicker.css';

const MAX_SIZE = 256;
const MAX_BYTES = 120_000;

function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取头像失败'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('头像格式无效'));
      image.onload = () => {
        const scale = Math.min(1, MAX_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('浏览器不支持头像处理'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let quality = 0.82;
        let data = canvas.toDataURL('image/jpeg', quality);
        while (data.length > MAX_BYTES * 1.37 && quality > 0.42) {
          quality -= 0.08;
          data = canvas.toDataURL('image/jpeg', quality);
        }
        if (data.length > MAX_BYTES * 1.37) {
          reject(new Error('头像文件过大，请选择更小的图片'));
          return;
        }
        resolve(data);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

interface SettingsAvatarPickerProps {
  avatarData?: string;
  onChange: (avatarData: string) => void;
  onRemove: () => void;
  onError: (message: string) => void;
}

export const SettingsAvatarPicker: React.FC<SettingsAvatarPickerProps> = ({
  avatarData,
  onChange,
  onRemove,
  onError,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasAvatar = typeof avatarData === 'string' && avatarData.startsWith('data:image/');

  const chooseAvatar = () => inputRef.current?.click();

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    chooseAvatar();
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      onChange(await compressAvatar(file));
    } catch (error) {
      onError(error instanceof Error ? error.message : '头像处理失败');
    }
  };

  return (
    <div className="settings-avatar-editor">
      <div className="settings-avatar-editor-preview-column">
        <div
          className={`settings-avatar-editor-preview ${hasAvatar ? 'has-image' : 'is-empty'}`}
          role="button"
          tabIndex={0}
          aria-label={tl('点击上传头像', 'Click to upload an avatar')}
          onClick={chooseAvatar}
          onKeyDown={handleKeyDown}
        >
          {hasAvatar ? (
            <img
              src={avatarData}
              alt=""
              draggable={false}
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span className="settings-avatar-editor-empty-label">无</span>
          )}
        </div>
        <button
          type="button"
          className="settings-avatar-editor-remove"
          disabled={!hasAvatar}
          onClick={onRemove}
        >
          {tl('删除头像', 'Remove avatar')}
        </button>
      </div>
      <input
        ref={inputRef}
        className="settings-avatar-editor-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => void handleFile(event)}
      />
      <div className="settings-avatar-editor-info">
        <div className="settings-avatar-editor-label">{tl('当前头像', 'Current avatar')}</div>
        <div className="settings-avatar-editor-state">
          <span className={`settings-avatar-editor-dot ${hasAvatar ? 'active' : ''}`} />
          {hasAvatar
            ? tl('正在使用自定义头像', 'Custom avatar is active')
            : tl('正在使用名称首字符', 'Using the first character of your name')}
        </div>
        <div className="settings-avatar-editor-hint">
          {tl(
            '点击左侧头像选择图片，上传后会同步到大厅玩家列表和聊天室。',
            'Click the avatar to choose an image; it will sync to the lobby player list and chat.'
          )}
        </div>
      </div>
    </div>
  );
};
