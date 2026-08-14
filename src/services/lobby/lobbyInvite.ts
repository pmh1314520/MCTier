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

export const buildLobbyInviteLink = (invite: LobbyInvite): string => {
  const params = new URLSearchParams({
    v: '2',
    name: invite.name,
    pwd: invite.password,
  });
  const serverNode = cleanOptional(invite.serverNode);
  const signalingServer = cleanOptional(invite.signalingServer);
  if (serverNode) params.set('node', serverNode);
  if (signalingServer) params.set('signal', signalingServer);
  return `mctier://join?${params.toString()}`;
};

export const parseLobbyInviteLink = (raw: string): LobbyInvite | null => {
  const match = raw.trim().match(/^mctier:\/\/join\/?\?([^\s]+)$/i);
  if (!match) return null;

  const params = new URLSearchParams(match[1]);
  const name = params.get('name')?.trim() || '';
  if (!name) return null;

  return {
    name,
    password: params.get('pwd') || '',
    serverNode: cleanOptional(params.get('node')),
    signalingServer: cleanOptional(params.get('signal')),
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
    if (parsed) return parsed;
  }

  const name = extractField(text, ['大厅名称', 'Lobby Name']);
  if (name) {
    return {
      name,
      password: extractField(text, ['密码', 'Password'], true) || '',
      serverNode: extractField(text, ['服务器节点', 'Server Node']),
      signalingServer: extractField(text, ['信令服务器', 'Signaling Server']),
    };
  }

  const legacyParts = text.trim().split('|');
  if (legacyParts.length === 2 && legacyParts[0].trim()) {
    return { name: legacyParts[0].trim(), password: legacyParts[1].trim() };
  }
  return null;
};

export const formatLobbyInviteText = (invite: LobbyInvite, language: 'zh' | 'en'): string => {
  const link = buildLobbyInviteLink(invite);
  if (language === 'en') {
    return [
      '——————— Invitation to Join Lobby ———————',
      'Copy everything, then open MCTier - Join Lobby (auto-detected)',
      `Lobby Name: ${invite.name}`,
      `Password: ${invite.password}`,
      ...(invite.serverNode ? [`Server Node: ${invite.serverNode}`] : []),
      ...(invite.signalingServer ? [`Signaling Server: ${invite.signalingServer}`] : []),
      `Invite Link: ${link}`,
      '————— https://mctier.pmhs.top —————',
    ].join('\n');
  }

  return [
    '——————— 邀请您加入大厅 ———————',
    '完整复制后打开 MCTier-加入大厅 界面（自动识别）',
    `大厅名称：${invite.name}`,
    `密码：${invite.password}`,
    ...(invite.serverNode ? [`服务器节点：${invite.serverNode}`] : []),
    ...(invite.signalingServer ? [`信令服务器：${invite.signalingServer}`] : []),
    `邀请链接：${link}`,
    '————— https://mctier.pmhs.top —————',
  ].join('\n');
};
