import { audioDevices } from './audioDevices';
import { microphoneDevices, nativeMicrophoneSupported, openMicrophone, type MicrophoneDevice } from './nativeMicrophone';

// Keep the existing preference key and exports so upgrades retain user choices.
export type NvidiaNoiseMode = 'auto' | 'off' | 'nvidia' | 'amd';
let lobbyOverride: NvidiaNoiseMode | null = null;
export function nvidiaNoiseMode(lobby = true): NvidiaNoiseMode {
  const saved = localStorage.getItem('mctier_nvidia_noise');
  const globalMode = saved === 'off' || saved === 'nvidia' || saved === 'amd' ? saved : 'auto';
  return lobby ? lobbyOverride ?? globalMode : globalMode;
}
export function setNvidiaNoiseMode(mode: NvidiaNoiseMode, lobby: boolean): void {
  if (lobby) lobbyOverride = mode;
  else localStorage.setItem('mctier_nvidia_noise', mode);
  window.dispatchEvent(new Event('mctier-audio-processing-changed'));
}
export function resetLobbyNoiseMode(): void { lobbyOverride = null; }
export function noiseProvider(device: Pick<MediaDeviceInfo, 'kind' | 'label'>): 'nvidia' | 'amd' | null {
  if (device.kind !== 'audioinput') return null;
  if (/NVIDIA Broadcast|NVIDIA RTX Voice/i.test(device.label)) return 'nvidia';
  if (/AMD (Streaming Audio Device|Noise Suppression)/i.test(device.label)) return 'amd';
  return null;
}
export async function aiNoiseDevices(): Promise<MicrophoneDevice[]> {
  return (await microphoneDevices()).filter(device => noiseProvider(device));
}
export async function aiNoiseDevice(): Promise<MicrophoneDevice | undefined> {
  const mode = nvidiaNoiseMode();
  if (mode === 'off') return undefined;
  const devices = (await aiNoiseDevices()).filter(device => mode === 'auto' || noiseProvider(device) === mode);
  return devices.find(device => device.deviceId === audioDevices.getInputDeviceId()) ?? devices[0];
}
export async function nvidiaNoiseDevice(): Promise<MicrophoneDevice | undefined> {
  return (await aiNoiseDevices()).find(device => noiseProvider(device) === 'nvidia');
}
export async function microphoneConstraints(): Promise<MediaTrackConstraints> {
  const device = await aiNoiseDevice();
  const preferred = device?.deviceId || audioDevices.getInputDeviceId();
  return {
    echoCancellation: true,
    noiseSuppression: !device,
    autoGainControl: true,
    ...(preferred ? { deviceId: device ? { exact: preferred } : { ideal: preferred } } : {}),
  };
}
async function acquire(): Promise<MediaStream> {
  const device = await aiNoiseDevice();
  try { return await openMicrophone(device?.deviceId || audioDevices.getInputDeviceId(), !device); }
  catch (error) {
    // A virtual device can disappear while the driver is being restarted.
    if (!(error instanceof DOMException) || !['NotFoundError', 'OverconstrainedError'].includes(error.name)) throw error;
    return openMicrophone();
  }
}
export async function captureVoiceStream(): Promise<MediaStream> {
  let stream = await acquire();
  try {
    if (await nativeMicrophoneSupported()) return stream;
    // Device labels become available only after the initial microphone permission.
    const device = await aiNoiseDevice();
    if (device && stream.getAudioTracks()[0]?.getSettings().deviceId !== device.deviceId) {
      const next = await acquire();
      stream.getTracks().forEach(track => track.stop());
      stream = next;
    }
    return stream;
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    throw error;
  }
}
