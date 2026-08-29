import React, { useRef } from 'react';
import './Avatar.css';

const MAX_SIZE = 256;
const MAX_BYTES = 120_000;

const readCompressedAvatar = (file: File): Promise<string> => new Promise((resolve, reject) => {
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

export interface AvatarProps {
  name?: string;
  avatarData?: string;
  size?: number;
  editable?: boolean;
  onChange?: (avatarData: string) => void;
  onError?: (message: string) => void;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  avatarData,
  size = 44,
  editable = false,
  onChange,
  onError,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = Array.from((name || '?').trim())[0] || '?';

  const chooseAvatar = () => {
    if (!editable || !onChange) return;
    inputRef.current?.click();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editable || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    chooseAvatar();
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      onChange?.(await readCompressedAvatar(file));
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '头像处理失败');
    }
  };

  return (
    <div
      className={`mct-avatar ${avatarData ? 'has-image' : 'no-image'} ${editable ? 'mct-avatar-editable' : ''} ${className}`.trim()}
      style={{ width: size, height: size }}
      onClick={chooseAvatar}
      onKeyDown={handleKeyDown}
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? '上传头像' : `${name || '玩家'}的头像`}
    >
      {avatarData ? <img src={avatarData} alt="" draggable={false} /> : <span>{initial.toUpperCase()}</span>}
      {editable && <input ref={inputRef} type="file" accept="image/*" onChange={(event) => void handleFile(event)} />}
    </div>
  );
};
