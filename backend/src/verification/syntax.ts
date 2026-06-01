import validator from 'validator';

export const ROLE_LOCALPARTS = new Set([
  // Generic contact
  'info', 'contact', 'contactus', 'hello', 'hi', 'hey', 'greetings', 'enquiries', 'enquiry',
  'inquiries', 'inquiry', 'general', 'getintouch',
  // Support / service
  'support', 'help', 'helpdesk', 'helpme', 'assist', 'assistance', 'service', 'services',
  'customerservice', 'customersupport', 'care', 'customercare', 'techsupport', 'tech',
  'feedback', 'questions', 'question', 'answers',
  // Sales / business
  'sales', 'salesteam', 'buy', 'orders', 'order', 'purchase', 'billing', 'invoice',
  'invoices', 'payments', 'pay', 'accounts', 'accounting', 'finance', 'revenue',
  'business', 'biz', 'commercial', 'enterprise', 'partnerships', 'partners', 'partner',
  'reseller', 'wholesale', 'vendor', 'vendors', 'procurement', 'rfq', 'quotes', 'quote',
  // Marketing
  'marketing', 'ads', 'advertising', 'promotions', 'promo', 'newsletter', 'newsletters',
  'emailmarketing', 'campaigns', 'campaign', 'outreach', 'growth', 'digitalmarketing',
  // HR / recruiting
  'jobs', 'careers', 'career', 'recruiting', 'recruitment', 'recruiter', 'hiring',
  'hr', 'humanresources', 'talent', 'apply', 'applications', 'resume', 'cv',
  'internship', 'internships', 'opportunities',
  // Technical / IT
  'admin', 'administrator', 'sysadmin', 'webmaster', 'postmaster', 'hostmaster',
  'abuse', 'security', 'noc', 'devops', 'it', 'itsupport', 'sys', 'system',
  'root', 'server', 'network', 'infra', 'infrastructure', 'ops', 'operations',
  // Office / team
  'office', 'team', 'staff', 'crew', 'people', 'hq', 'headquarters', 'main',
  'reception', 'reception', 'front', 'frontdesk', 'desk', 'administration',
  // Communication
  'press', 'media', 'pr', 'publicrelations', 'communications', 'spokesperson',
  'news', 'newsroom', 'journalist', 'editor', 'editors', 'editorial', 'content',
  // Legal / compliance
  'legal', 'law', 'compliance', 'privacy', 'gdpr', 'dpo', 'copyright', 'trademark',
  'dmca', 'abuse', 'report',
  // Technical noise
  'noreply', 'no-reply', 'noreply', 'donotreply', 'do-not-reply', 'bounce', 'bounces',
  'mailer', 'mailer-daemon', 'mailerdaemon', 'notification', 'notifications', 'alert',
  'alerts', 'automated', 'autoresponder', 'auto',
  // Misc garbage
  'test', 'testing', 'demo', 'sample', 'example', 'spam', 'user', 'users',
  'root', 'guest', 'anonymous', 'public', 'open', 'dev', 'development', 'staging',
  'production', 'prod', 'api', 'bot', 'robot', 'crawler', 'scraper',
  // Payment / e-commerce
  'pay', 'payment', 'checkout', 'store', 'shop', 'ecommerce',
  // Social / community
  'social', 'community', 'forum', 'discord', 'slack', 'chat',
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
