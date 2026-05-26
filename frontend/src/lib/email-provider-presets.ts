/**
 * Common email-provider connection presets. Used by the "Add SMTP account" flow
 * so users don't have to memorize host/port settings. Picking a preset auto-fills
 * the form; "Custom" leaves the fields blank.
 *
 * App-password instructions are linked per-provider since each one buries it
 * in a different security-settings page.
 */

export interface ProviderPreset {
  id: string;
  name: string;
  icon: string; // emoji or short label — kept dependency-free
  /** Tagline shown next to the name in the picker */
  tagline: string;
  /** SMTP send config */
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean; // true = implicit SSL (port 465), false = STARTTLS (587)
  /** IMAP receive config (used for reply detection) */
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  /** Where to generate an app-password on this provider's site */
  appPasswordUrl: string;
  /** Specific guidance for getting set up */
  setupNote: string;
  /** True if the provider requires 2FA before an app password is available */
  requires2FA: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'outlook',
    name: 'Outlook / Hotmail / Live',
    icon: 'O',
    tagline: 'Personal Microsoft accounts',
    smtpHost: 'smtp-mail.outlook.com',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: 'https://account.live.com/proofs/AppPassword',
    setupNote: 'Enable 2-step verification, then create an app password. Use that password here, not your normal Microsoft password.',
    requires2FA: true,
  },
  {
    id: 'office365',
    name: 'Microsoft 365 (work/school)',
    icon: 'M',
    tagline: 'Outlook on a custom domain',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: 'https://account.microsoft.com/security',
    setupNote: 'Some tenants disable SMTP AUTH by default — your admin may need to enable "Authenticated SMTP" in the M365 Admin Center.',
    requires2FA: true,
  },
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    icon: 'Y',
    tagline: '@yahoo.com',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: 'https://login.yahoo.com/account/security',
    setupNote: 'Click "Generate app password" under Account Security. Yahoo requires this — your normal password won\'t work for SMTP.',
    requires2FA: true,
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    icon: '',
    tagline: '@icloud.com / @me.com',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: 'https://appleid.apple.com/account/manage',
    setupNote: 'Sign in to appleid.apple.com → "App-Specific Passwords" → Generate. Requires 2FA on your Apple ID.',
    requires2FA: true,
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    icon: 'Z',
    tagline: 'Free/paid Zoho Mail',
    smtpHost: 'smtp.zoho.com',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: 'imap.zoho.com',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: 'https://accounts.zoho.com/home#security/application_passwords',
    setupNote: 'Generate an application-specific password from your Zoho account security panel.',
    requires2FA: false,
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    icon: 'F',
    tagline: '@fastmail.com / custom domain',
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: 'https://app.fastmail.com/settings/security/devices',
    setupNote: 'Create an app password under Settings → Privacy & Security → Connected apps & integrations.',
    requires2FA: false,
  },
  {
    id: 'protonmail',
    name: 'Proton Mail',
    icon: 'P',
    tagline: 'Requires Proton Mail Bridge',
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    smtpSecure: false,
    imapHost: '127.0.0.1',
    imapPort: 1143,
    imapSecure: false,
    appPasswordUrl: 'https://proton.me/mail/bridge',
    setupNote: 'Proton Mail only supports SMTP via the Proton Bridge desktop app. Install Bridge, get the bridge credentials, and use those.',
    requires2FA: false,
  },
  {
    id: 'mailgun',
    name: 'Mailgun SMTP',
    icon: 'MG',
    tagline: 'Transactional sending',
    smtpHost: 'smtp.mailgun.org',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: '',
    imapPort: 0,
    imapSecure: false,
    appPasswordUrl: 'https://app.mailgun.com/app/sending/domains',
    setupNote: 'Use your Mailgun SMTP credentials from the domain dashboard. Mailgun doesn\'t support IMAP — reply tracking won\'t work.',
    requires2FA: false,
  },
  {
    id: 'hostinger',
    name: 'Hostinger',
    icon: 'H',
    tagline: 'Hostinger email hosting',
    smtpHost: 'smtp.hostinger.com',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: 'imap.hostinger.com',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: 'https://hpanel.hostinger.com/',
    setupNote: 'Use your normal Hostinger email password. Found in hPanel → Emails → manage your email account.',
    requires2FA: false,
  },
  {
    id: 'godaddy',
    name: 'GoDaddy / Microsoft 365 via GoDaddy',
    icon: 'GD',
    tagline: 'GoDaddy-hosted email',
    smtpHost: 'smtpout.secureserver.net',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: 'imap.secureserver.net',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: 'https://email.godaddy.com/',
    setupNote: 'Use your normal email password. If your GoDaddy email is actually Microsoft 365, switch to the Microsoft 365 preset above.',
    requires2FA: false,
  },
  {
    id: 'namecheap',
    name: 'Namecheap Private Email',
    icon: 'NC',
    tagline: 'Namecheap email hosting',
    smtpHost: 'mail.privateemail.com',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: 'mail.privateemail.com',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: 'https://privateemail.com/',
    setupNote: 'Use your normal Private Email password.',
    requires2FA: false,
  },
  {
    id: 'aws-workmail',
    name: 'Amazon WorkMail',
    icon: 'WM',
    tagline: 'AWS-hosted email',
    smtpHost: 'smtp.mail.us-east-1.awsapps.com',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: 'imap.mail.us-east-1.awsapps.com',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: 'https://docs.aws.amazon.com/workmail/latest/userguide/using-imap.html',
    setupNote: 'Replace "us-east-1" with your WorkMail region. Use your IAM-managed email password.',
    requires2FA: false,
  },
  {
    id: 'custom',
    name: 'Custom SMTP server',
    icon: '⚙',
    tagline: 'Any other provider',
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    appPasswordUrl: '',
    setupNote: 'Enter your own SMTP host, port, username, and password. Check your provider\'s docs.',
    requires2FA: false,
  },
];

/** Auto-detect a likely provider from an email address. Returns null on no match. */
export function detectProviderFromEmail(email: string): ProviderPreset | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  if (/^(outlook|hotmail|live|msn)\./.test(domain) || domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com') {
    return PROVIDER_PRESETS.find((p) => p.id === 'outlook') ?? null;
  }
  if (domain === 'yahoo.com' || domain === 'ymail.com' || domain === 'rocketmail.com') {
    return PROVIDER_PRESETS.find((p) => p.id === 'yahoo') ?? null;
  }
  if (domain === 'icloud.com' || domain === 'me.com' || domain === 'mac.com') {
    return PROVIDER_PRESETS.find((p) => p.id === 'icloud') ?? null;
  }
  if (domain === 'zoho.com' || domain === 'zohomail.com') {
    return PROVIDER_PRESETS.find((p) => p.id === 'zoho') ?? null;
  }
  if (domain === 'fastmail.com' || domain === 'fastmail.fm') {
    return PROVIDER_PRESETS.find((p) => p.id === 'fastmail') ?? null;
  }
  if (domain === 'proton.me' || domain === 'protonmail.com' || domain === 'pm.me') {
    return PROVIDER_PRESETS.find((p) => p.id === 'protonmail') ?? null;
  }
  return null;
}
