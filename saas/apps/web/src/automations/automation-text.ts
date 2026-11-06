import type { AutomationCapability, AutomationSummary } from '@disparazap/contracts';

/** Frases em português simples para cada automação (o que dispara e o que acontece) */

const quoted = (word: string) => `“${word}”`;

/** “preço”, “valor” ou “link” (até 3 palavras; o resto vira "e mais N") */
export function keywordsText(keywords: readonly string[]): string {
  if (keywords.length === 0) return 'qualquer coisa';
  const shown = keywords.slice(0, 3).map(quoted);
  const rest = keywords.length - shown.length;
  const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} ou ${shown.at(-1)}`;
  return rest > 0 ? `${list} (e mais ${rest})` : (list ?? '');
}

export function whenText(automation: AutomationSummary): string {
  const where = automation.postBound ? `na publicação ${automation.postTitle ? quoted(automation.postTitle) : 'escolhida'}` : 'em qualquer publicação';
  switch (automation.trigger) {
    case 'comment':
      return `Quando alguém comentar ${keywordsText(automation.keywords)} ${where}`;
    case 'live_comment':
      return `Quando alguém comentar ${keywordsText(automation.keywords)} numa live`;
    case 'story_reply':
      return automation.keywords.length ? `Quando alguém responder a um story com ${keywordsText(automation.keywords)}` : 'Quando alguém responder a um story';
    case 'story_mention':
      return 'Quando alguém mencionar a conta num story';
    default:
      return 'Quando a Zernio disparar esta automação';
  }
}

export function thenText(automation: AutomationSummary): string {
  if (automation.hasDm && automation.hasPublicReply) return 'envia uma DM e responde em público';
  if (automation.hasDm) return 'envia uma DM';
  if (automation.hasPublicReply) return 'responde em público';
  return 'nenhuma resposta configurada';
}

export function automationSentence(automation: AutomationSummary): string {
  return `${whenText(automation)} → ${thenText(automation)}${automation.followersOnly ? ' (só para seguidores)' : ''}`;
}

export function repeatText(automation: AutomationSummary): string {
  if (automation.repeat.mode === 'once') return 'Uma vez por pessoa';
  return automation.repeat.cooldownHours ? `Sempre, com espera de ${automation.repeat.cooldownHours} h` : 'Sempre';
}

export function matchModeText(matchMode: string | null): string {
  switch (matchMode) {
    case 'word':
      return 'como palavra inteira';
    case 'contains':
      return 'em qualquer parte do comentário';
    case 'exact':
      return 'só o comentário exato';
    default:
      return 'padrão da Zernio';
  }
}

export const CAPABILITY_TEXT: Readonly<Record<AutomationCapability, string>> = {
  full: 'DM, botões, só seguidores e story',
  dm: 'DM e botões',
  public_reply: 'só resposta pública',
  unsupported: 'sem automações',
};
