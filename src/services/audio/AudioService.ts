/**
 * 音效服务
 * 管理应用中的所有音效播放
 */

export type SoundType = 'newMessage' | 'userJoined' | 'userLeft';

class AudioService {
  private sounds: Map<SoundType, HTMLAudioElement> = new Map();
  private enabled: boolean = true;

  constructor() {
    this.initializeSounds();
  }

  /**
   * 初始化所有音效
   */
  private initializeSounds() {
    try {
      // 新消息音效
      const newMessageSound = new Audio('/NewMsg.mp3');
      newMessageSound.volume = 0.5;
      this.sounds.set('newMessage', newMessageSound);

      // 用户加入音效
      const userJoinedSound = new Audio('/UserJoined.mp3');
      userJoinedSound.volume = 0.5;
      this.sounds.set('userJoined', userJoinedSound);

      // 用户离开音效
      const userLeftSound = new Audio('/UserLeft.mp3');
      userLeftSound.volume = 0.5;
      this.sounds.set('userLeft', userLeftSound);

      console.log('音效系统初始化成功');
    } catch (error) {
      console.error('音效系统初始化失败:', error);
    }
  }

  /**
   * 播放指定音效
   */
  async play(soundType: SoundType): Promise<void> {
    if (!this.enabled) {
      console.log('音效已禁用，跳过播放:', soundType);
      return;
    }

    try {
      const sound = this.sounds.get(soundType);
      if (!sound) {
        console.warn('未找到音效:', soundType);
        return;
      }

      // 重置音频到开始位置
      sound.currentTime = 0;
      
      // 播放音效
      await sound.play();
      console.log('播放音效:', soundType);
    } catch (error) {
      console.error('播放音效失败:', soundType, error);
    }
  }

  /**
   * 设置音效音量
   */
  setVolume(volume: number) {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.sounds.forEach(sound => {
      sound.volume = clampedVolume;
    });
    console.log('音效音量已设置为:', clampedVolume);
  }

  /**
   * 启用或禁用音效
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    console.log('音效系统', enabled ? '已启用' : '已禁用');
  }

  /**
   * 获取音效启用状态
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// 导出单例
export const audioService = new AudioService();
