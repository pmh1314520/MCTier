import { invoke } from '@tauri-apps/api/core';
import { isSafeChatPublicKey } from '../../security/trustBoundary';

const CLIENT_ID_PATTERN = /^[a-f0-9]{64}$/;
const CHALLENGE_PATTERN = /^[a-f0-9]{64}$/;

export interface SignalingIdentity {
  clientId: string;
  identityPublicKey: string;
}

export interface SignalingRegistrationProof extends SignalingIdentity {
  challengeSignature: string;
}

function isIdentity(value: unknown): value is SignalingIdentity {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.clientId === 'string' &&
    CLIENT_ID_PATTERN.test(input.clientId) &&
    isSafeChatPublicKey(input.identityPublicKey)
  );
}

export async function prepareSignalingIdentity(): Promise<SignalingIdentity> {
  const identity = await invoke<unknown>('prepare_signaling_identity');
  if (!isIdentity(identity)) throw new Error('后端返回的信令身份无效');
  return identity;
}

export async function signSignalingRegistration(
  challenge: string,
  lobbyName: string,
  virtualIp: string
): Promise<SignalingRegistrationProof> {
  if (!CHALLENGE_PATTERN.test(challenge)) throw new Error('信令 challenge 格式无效');
  const proof = await invoke<unknown>('sign_signaling_registration', {
    challenge,
    lobbyName,
    virtualIp,
  });
  if (!isIdentity(proof)) throw new Error('后端返回的信令身份无效');
  const signature = (proof as unknown as Record<string, unknown>).challengeSignature;
  if (typeof signature !== 'string' || signature.length < 64 || signature.length > 256) {
    throw new Error('后端返回的 challenge 签名无效');
  }
  return proof as SignalingRegistrationProof;
}

export function isServerChallenge(value: unknown): value is string {
  return typeof value === 'string' && CHALLENGE_PATTERN.test(value);
}
