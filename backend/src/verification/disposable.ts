// Disposable / temporary email domain detection.
// Curated subset; load from `disposable-email-domains` package or remote list in prod.
const DISPOSABLE = new Set([
  '10minutemail.com', 'guerrillamail.com', 'mailinator.com', 'tempmail.com',
  'throwawaymail.com', 'fakeinbox.com', 'getnada.com', 'sharklasers.com',
  'temp-mail.org', 'yopmail.com', 'maildrop.cc', 'mintemail.com',
  'dispostable.com', 'mohmal.com', 'spamgourmet.com', 'trashmail.com',
  'inboxbear.com', 'mailcatch.com', 'tempinbox.com', 'mail-temporaire.fr',
]);

export function isDisposable(domain: string): boolean {
  return DISPOSABLE.has(domain.toLowerCase());
}
