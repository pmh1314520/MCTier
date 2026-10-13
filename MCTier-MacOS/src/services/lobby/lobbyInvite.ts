import {
  isSafeServerNode,
  isSafeSignalingServer,
  sanitizeUntrustedText,
} from '../../security/trustBoundary.ts';
import { invoke } from '@tauri-apps/api/core';

export interface LobbyInvite {
  name: string;
  password: string;
  serverNode?: string;
  signalingServer?: string;
}

const cleanOptional = (value?: string | null): string | undefined => {
  const cleaned = value?.trim();
  return cleaned || undefined;
};

export const buildLobbyInviteLink = async (invite: LobbyInvite): Promise<string> => {
  const secret = invite.password ? await invoke<string>('export_lobby_password', { password: invite.password }) : '';
  const params = new URLSearchParams({
    v: '3',
    name: sanitizeUntrustedText(invite.name, 64),
    secret,
  });
  const serverNode = cleanOptional(invite.serverNode);
  const signalingServer = cleanOptional(invite.signalingServer);
  if (serverNode && isSafeServerNode(serverNode) && serverNode !== 'custom') params.set('node', serverNode);
  if (signalingServer && isSafeSignalingServer(signalingServer)) params.set('signal', signalingServer);
  return `mctier://join?${params.toString()}`;
};

export const parseLobbyInviteLink = (raw: string): LobbyInvite | null => {
  const match = raw.trim().match(/^mctier:\/\/join\/?\?([^\s]+)$/i);
  if (!match) return null;

  const params = new URLSearchParams(match[1]);
  const version = params.get('v');
  if (version && !['1', '2', '3'].includes(version)) return null;
  const secret = params.get('secret') || '';
  if (version === '3' && (secret.length > 4096 || (secret && !/^mctier-invite-v3:[A-Za-z0-9_-]+$/.test(secret)))) return null;
  const name = sanitizeUntrustedText(params.get('name'), 64).trim();
  if (!name) return null;

  const rawServerNode = cleanOptional(params.get('node'));
  const rawSignalingServer = cleanOptional(params.get('signal'));
  // Deep links can arrive from another application. Reject an invite rather
  // than allowing an unvalidated endpoint to reach the join command.
  if (rawServerNode && !isSafeServerNode(rawServerNode)) return null;
  if (rawSignalingServer && !isSafeSignalingServer(rawSignalingServer)) return null;

  return {
    name,
    password: version === '3' ? secret : sanitizeUntrustedText(params.get('pwd'), 128),
    serverNode: rawServerNode,
    signalingServer: rawSignalingServer,
  };
};

const extractField = (text: string, labels: string[], allowEmpty = false): string | undefined => {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const valuePattern = allowEmpty ? '([^\\r\\n]*)' : '([^\\r\\n]+)';
  const match = text.match(new RegExp(`(?:${escapedLabels.join('|')})\\s*[:：]\\s*${valuePattern}`, 'i'));
  return match ? match[1].trim() : undefined;
};

export const parseLobbyInviteText = (text: string): LobbyInvite | null => {
  const deepLink = text.match(/mctier:\/\/join\/?\?[^\s]+/i)?.[0];
  if (deepLink) {
    const parsed = parseLobbyInviteLink(deepLink);
    return parsed;
  }

  const name = extractField(text, ['大厅名称', 'Lobby Name']);
  if (name) {
    const serverNode = cleanOptional(extractField(text, ['服务器节点', 'Server Node']));
    const signalingServer = cleanOptional(extractField(text, ['信令服务器', 'Signaling Server']));
    if (serverNode && !isSafeServerNode(serverNode)) return null;
    if (signalingServer && !isSafeSignalingServer(signalingServer)) return null;
    return {
      name: sanitizeUntrustedText(name, 64),
      password: sanitizeUntrustedText(extractField(text, ['密码', 'Password'], true), 128),
      serverNode,
      signalingServer,
    };
  }

  const legacyParts = text.trim().split('|');
  if (legacyParts.length === 2 && legacyParts[0].trim()) {
    return {
      name: sanitizeUntrustedText(legacyParts[0], 64).trim(),
      password: sanitizeUntrustedText(legacyParts[1], 128).trim(),
    };
  }
  return null;
};

export const formatLobbyInviteText = async (invite: LobbyInvite, language: 'zh' | 'en'): Promise<string> => {
  const link = await buildLobbyInviteLink(invite);
  const serverNode = cleanOptional(invite.serverNode);
  const signalingServer = cleanOptional(invite.signalingServer);
  const safeServerNode = serverNode && isSafeServerNode(serverNode) ? serverNode : undefined;
  const safeSignalingServer = signalingServer && isSafeSignalingServer(signalingServer) ? signalingServer : undefined;
  const name = sanitizeUntrustedText(invite.name, 64);
  if (language === 'en') {
    return [
      '——————— Invitation to Join Lobby ———————',
      'Copy everything, then open MCTier - Join Lobby (auto-detected)',
      `Lobby Name: ${name}`,
      ...(safeServerNode ? [`Server Node: ${safeServerNode}`] : []),
      ...(safeSignalingServer ? [`Signaling Server: ${safeSignalingServer}`] : []),
      `Invite Link: ${link}`,
      '————— https://mctier.pmhs.top —————',
    ].join('\n');
  }

  return [
    '——————— 邀请您加入大厅 ———————',
    '完整复制后打开 MCTier-加入大厅 界面（自动识别）',
    `大厅名称：${name}`,
    ...(safeServerNode ? [`服务器节点：${safeServerNode}`] : []),
    ...(safeSignalingServer ? [`信令服务器：${safeSignalingServer}`] : []),
    `邀请链接：${link}`,
    '————— https://mctier.pmhs.top —————',
  ].join('\n');
};
