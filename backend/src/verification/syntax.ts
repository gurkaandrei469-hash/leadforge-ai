import validator from 'validator';

const ROLE_LOCALPARTS = new Set([
  'info', 'contact', 'support', 'sales', 'admin', 'help', 'hello', 'team', 'office',
  'mail', 'noreply', 'no-reply', 'press', 'media', 'jobs', 'careers', 'billing',
  'accounts', 'security', 'privacy', 'legal', 'marketing', 'webmaster', 'postmaster',
]);

export function checkSyntax(email: string): { valid: boolean; normalized: string | null; isRole: boolean; reason?: string } {
  const trimmed = email.trim().toLowerCase();
  if (!validator.isEmail(trimmed, { allow_display_name: false })) {
    return { valid: false, normalized: null, isRole: false, reason: 'syntax_invalid' };
  }
  const [local] = trimmed.split('@');
  return {
    valid: true,
    normalized: trimmed,
    isRole: ROLE_LOCALPARTS.has(local),
  };
}
