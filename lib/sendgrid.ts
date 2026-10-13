import sgMail from '@sendgrid/mail';
import { PARTNER_TYPE_LABELS, PartnerType, SUPER_ADMIN_EMAIL } from './types';

function formatMoney(amountMinor: number, currency: string): string {
  const code = (currency || 'eur').toUpperCase();
  const major = (amountMinor || 0) / 100;
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency: code }).format(major);
  } catch {
    return `${code} ${major.toFixed(2)}`;
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let _initialized = false;

function client() {
  if (_initialized) return sgMail;
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY is not set');
  sgMail.setApiKey(key);
  _initialized = true;
  return sgMail;
}

function fromAddress() {
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!from) throw new Error('SENDGRID_FROM_EMAIL is not set');
  return from;
}

function siteUrl() {
  return process.env.SITE_URL || 'https://www.liveonwith.me';
}

function wrapEmail(innerHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f4ee;font-family:Georgia,'Times New Roman',serif;color:#25312d;">
    <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
      <div style="text-align:center;font-family:Georgia,serif;font-size:22px;letter-spacing:0.02em;margin-bottom:32px;color:#25312d;">
        LiveOnWith.me
      </div>
      <div style="background:#fffdf9;border:1px solid #e8e1d7;border-radius:22px;padding:36px 32px;">
        ${innerHtml}
      </div>
      <div style="text-align:center;font-family:Inter,system-ui,sans-serif;font-size:12px;color:#6d7772;margin-top:24px;">
        LiveOnWith.me — a quiet place to remember and be remembered.
      </div>
    </div>
  </body>
</html>`;
}

const TRANSACTIONAL_SETTINGS = {
  // Password reset and claim invites are transactional + security-sensitive.
  // Disable tracking so links aren't rewritten through sendgrid.net (which
  // tanks inbox rate for new senders) and no 1x1 pixel is injected.
  trackingSettings: {
    clickTracking: { enable: false, enableText: false },
    openTracking: { enable: false },
    subscriptionTracking: { enable: false },
  },
  mailSettings: {
    bypassListManagement: { enable: true },
  },
} as const;

export async function sendPasswordResetEmail(to: string, token: string) {
  const link = `${siteUrl()}/auth/action?mode=resetPassword&token=${encodeURIComponent(token)}`;

  const subject = 'Reset your LiveOnWith.me password';

  const text = [
    'Someone asked to reset the password on your LiveOnWith.me account.',
    '',
    'Open the link below within the next hour to choose a new one:',
    link,
    '',
    "If you didn't request this, you can safely ignore this email — your password won't change.",
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:28px;line-height:1.2;margin:0 0 18px;color:#25312d;">
          Reset your password
        </h1>
        <p style="font-family:Inter,system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          Someone asked to reset the password on your LiveOnWith.me account. Click the button below within the next hour to choose a new one.
        </p>
        <p style="text-align:center;margin:32px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Choose a new password
          </a>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          If the button doesn't work, copy and paste this into your browser:<br>
          <span style="word-break:break-all;color:#688076;">${link}</span>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          If you didn't ask for this, you can safely ignore this email — your password won't change.
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

function firstName(fullName?: string): string {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0] || '';
}

export async function sendCustodyInvite(
  to: string,
  token: string,
  memorialName: string,
  inviterName: string | undefined,
  nominationType: 'primary' | 'backup' | 'coManager'
) {
  const link = `${siteUrl()}/custody/accept/${encodeURIComponent(token)}`;
  const from = inviterName?.trim() ? inviterName.trim() : 'a family member';

  const heading =
    nominationType === 'primary'
      ? `You've been invited to look after ${memorialName}'s memorial`
      : nominationType === 'coManager'
        ? `You've been invited to help manage ${memorialName}'s memorial`
        : `You've been named a backup custodian for ${memorialName}'s memorial`;

  const bodyIntro =
    nominationType === 'primary'
      ? `${from} would like to pass custody of ${memorialName}'s memorial on LiveOnWith.me to you. Accepting means you become the person who looks after it from now on. The memorial URL stays the same.`
      : nominationType === 'coManager'
        ? `${from} has invited you to help manage ${memorialName}'s memorial on LiveOnWith.me. You'll be able to approve memories, add photos and edit the story alongside them.`
        : `${from} has named you as a backup custodian for ${memorialName}'s memorial on LiveOnWith.me. Nothing changes today — but if the primary custodian is ever unable to look after it, custody would move to you.`;

  const subject =
    nominationType === 'coManager'
      ? `Help manage ${memorialName}'s memorial`
      : nominationType === 'primary'
        ? `Custody of ${memorialName}'s memorial`
        : `Backup custodian for ${memorialName}'s memorial`;

  const text = [
    heading,
    '',
    bodyIntro,
    '',
    'Open the private link below to accept or decline:',
    link,
    '',
    "Please sign in with this email address so we can match the invitation to you. If you don't have a LiveOnWith.me account yet, we'll help you create one.",
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          ${heading}
        </h1>
        <p style="font-family:Inter,system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          ${bodyIntro}
        </p>
        <p style="text-align:center;margin:32px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open the invitation
          </a>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          If the button doesn't work, copy and paste this into your browser:<br>
          <span style="word-break:break-all;color:#688076;">${link}</span>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          Please sign in with this email address so we can match the invitation to you. If you don't have a LiveOnWith.me account yet, we'll help you create one.
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendContributionAlert(
  to: string,
  args: {
    memorialId: string;
    deceasedFullName: string;
    contributorName: string;
    relationship?: string;
    memoryText?: string;
    hasPhoto: boolean;
    isPrivate: boolean;
  },
) {
  const first = firstName(args.deceasedFullName) || args.deceasedFullName;
  const link = `${siteUrl()}/memorial/${encodeURIComponent(args.memorialId)}/manage`;

  const subject = args.isPrivate
    ? `A private message for ${first}'s family`
    : `A new memory for ${first}`;

  const who = args.relationship
    ? `${args.contributorName} (${args.relationship})`
    : args.contributorName;

  const whatBits: string[] = [];
  if (args.memoryText?.trim()) whatBits.push('a message');
  if (args.hasPhoto) whatBits.push('a photograph');
  const what = whatBits.length ? whatBits.join(' and ') : 'something';

  const snippet = (args.memoryText || '').trim().slice(0, 280);

  const privacyLine = args.isPrivate
    ? "It was marked as a private message — it won't appear on the memorial, but it's saved here for you."
    : "It's waiting for your approval before it appears on the memorial.";

  const text = [
    `${who} shared ${what} for ${args.deceasedFullName} on LiveOnWith.me.`,
    '',
    snippet ? `"${snippet}"` : '',
    snippet ? '' : null,
    privacyLine,
    '',
    'Open the memorial inbox to review:',
    link,
    '',
    '— LiveOnWith.me',
  ]
    .filter((x) => x !== null)
    .join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          ${args.isPrivate ? `A private message for ${args.deceasedFullName}'s family` : `A new memory for ${args.deceasedFullName}`}
        </h1>
        <p style="font-family:Inter,system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">
          <strong>${who}</strong> shared ${what} on LiveOnWith.me.
        </p>
        ${
          snippet
            ? `<blockquote style="font-family:Georgia,serif;font-style:italic;font-size:17px;line-height:1.55;color:#53635d;border-left:3px solid #dde5df;margin:0 0 20px;padding:4px 0 4px 16px;">${snippet.replace(/</g, '&lt;')}${(args.memoryText || '').length > 280 ? '…' : ''}</blockquote>`
            : ''
        }
        <p style="font-family:Inter,system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          ${privacyLine}
        </p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open the inbox
          </a>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          If the button doesn't work, copy and paste this into your browser:<br>
          <span style="word-break:break-all;color:#688076;">${link}</span>
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendMemorialWelcome(
  to: string,
  args: {
    memorialSlug: string;
    deceasedFullName: string;
    kind: 'memorial' | 'legacy';
    recipientName?: string;
  },
) {
  const manageLink = `${siteUrl()}/memorial/${encodeURIComponent(args.memorialSlug)}/manage`;
  const dashboardLink = `${siteUrl()}/dashboard`;
  const resetLink = `${siteUrl()}/auth/action?mode=resetPassword`;
  const hello = firstName(args.recipientName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const isLegacy = args.kind === 'legacy';

  const subject = isLegacy
    ? `Your page on LiveOnWith.me is ready`
    : `${args.deceasedFullName}'s memorial is ready`;

  const openingText = isLegacy
    ? `You've started a page about yourself on LiveOnWith.me. There's no deadline — come back whenever you'd like to add a photograph, a story, or anything else you want remembered.`
    : `You've started a memorial page for ${args.deceasedFullName} on LiveOnWith.me. There's no deadline. Come back whenever you'd like to add a photograph, write their story, or invite family to share their own memories.`;

  const bookmarkLine = isLegacy
    ? `We've saved it here on your dashboard so you can find it again easily:`
    : `We've saved it here on your dashboard so you can find it again easily:`;

  const text = [
    greeting,
    '',
    openingText,
    '',
    bookmarkLine,
    manageLink,
    '',
    'All your pages: ' + dashboardLink,
    '',
    `If you ever forget your password, you can request a reset here: ${resetLink}`,
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          ${isLegacy ? 'Your page is ready' : `A page for ${args.deceasedFullName}`}
        </h1>
        <p style="font-family:Inter,system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">
          ${greeting}
        </p>
        <p style="font-family:Inter,system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          ${openingText}
        </p>
        <p style="text-align:center;margin:32px 0;">
          <a href="${manageLink}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open your page
          </a>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#53635d;margin:0 0 10px;">
          You can also find all your pages at any time from your dashboard:
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.6;margin:0 0 22px;">
          <a href="${dashboardLink}" style="color:#2f5b48;text-decoration:underline;">${dashboardLink}</a>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          If you ever forget your password, you can
          <a href="${resetLink}" style="color:#688076;">request a reset here</a>.
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendClaimInvite(
  to: string,
  token: string,
  referralId: string,
  deceasedFullName: string,
  bereavedName?: string
) {
  const link = `${siteUrl()}/claim/${encodeURIComponent(referralId)}?token=${encodeURIComponent(token)}`;
  const hello = firstName(bereavedName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';

  const subject = `A memorial for ${deceasedFullName} is ready for you`;

  const text = [
    greeting,
    '',
    `A memorial page for ${deceasedFullName} has been set up for you on LiveOnWith.me — a quiet place to gather photos, stories and messages from the people who loved them.`,
    '',
    'You are the custodian of the page. Open the private link below to take it over, choose what to share, and go live when you are ready.',
    '',
    link,
    '',
    "The link is private to you. If you weren't expecting this email, you can safely ignore it.",
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:28px;line-height:1.2;margin:0 0 18px;color:#25312d;">
          A memorial for ${deceasedFullName}
        </h1>
        <p style="font-family:Inter,system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          ${greeting} a memorial page for <strong>${deceasedFullName}</strong> has been set up for you on LiveOnWith.me — a quiet place to gather photos, stories and messages from the people who loved them.
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          You are the custodian of the page. Open the private link below to take it over, choose what to share, and go live when you are ready.
        </p>
        <p style="text-align:center;margin:32px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open your memorial
          </a>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          If the button doesn't work, copy and paste this into your browser:<br>
          <span style="word-break:break-all;color:#688076;">${link}</span>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          The link is private to you. If you weren't expecting this email, you can safely ignore it.
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

// ─── Partner application lifecycle ──────────────────────────────────────────

export async function sendPartnerApplicationReceived(
  to: string,
  args: { contactName?: string; businessName: string; partnerType: PartnerType },
) {
  const hello = firstName(args.contactName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const typeLabel = PARTNER_TYPE_LABELS[args.partnerType] || 'partner';
  const subject = `We've received your LiveOnWith.me partner application`;

  const text = [
    greeting,
    '',
    `Thanks for applying to join LiveOnWith.me as a ${typeLabel.toLowerCase()} — we've received your application for ${args.businessName}.`,
    '',
    `We review each one by hand so there's a short wait. We'll be in touch once we've had a look. If anything's time-sensitive, just reply to this email.`,
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          Thanks for applying
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">
          Thanks for applying to join LiveOnWith.me as a ${typeLabel.toLowerCase()} — we've received your application for <strong>${escapeHtml(args.businessName)}</strong>.
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#53635d;margin:0 0 22px;">
          We review each one by hand so there's a short wait. We'll be in touch once we've had a look. If anything's time-sensitive, just reply to this email.
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendPartnerApplicationAdminNotice(args: {
  applicationId: string;
  applicantEmail: string;
  contactName: string;
  contactPhone?: string;
  website?: string;
  businessName: string;
  partnerType: PartnerType;
  notes?: string;
}) {
  const typeLabel = PARTNER_TYPE_LABELS[args.partnerType] || args.partnerType;
  const subject = `New partner application: ${args.businessName} (${typeLabel})`;
  const link = `${siteUrl()}/admin/partners`;

  const rows: Array<[string, string]> = [
    ['Business', args.businessName],
    ['Type', typeLabel],
    ['Contact', args.contactName],
    ['Email', args.applicantEmail],
  ];
  if (args.contactPhone) rows.push(['Phone', args.contactPhone]);
  if (args.website) rows.push(['Website', args.website]);
  if (args.notes?.trim()) rows.push(['Notes', args.notes.trim()]);

  const text = [
    'A new partner application has been submitted on LiveOnWith.me.',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Review it: ${link}`,
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          New partner application
        </h1>
        <table cellpadding="0" cellspacing="0" style="font-family:Inter,system-ui,sans-serif;font-size:15px;color:#25312d;width:100%;margin:0 0 22px;">
          ${rows
            .map(
              ([k, v]) => `<tr>
                <td style="padding:6px 12px 6px 0;color:#6d7772;vertical-align:top;width:110px;">${escapeHtml(k)}</td>
                <td style="padding:6px 0;">${escapeHtml(v)}</td>
              </tr>`,
            )
            .join('')}
        </table>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Review in admin
          </a>
        </p>
  `);

  await client().send({
    to: SUPER_ADMIN_EMAIL,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendPartnerApplicationApproved(
  to: string,
  args: { contactName?: string; businessName: string; partnerType: PartnerType },
) {
  const hello = firstName(args.contactName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const typeLabel = PARTNER_TYPE_LABELS[args.partnerType] || 'partner';
  const link = `${siteUrl()}/partner`;
  const subject = `You're approved — welcome to LiveOnWith.me`;

  const text = [
    greeting,
    '',
    `${args.businessName} is approved as a LiveOnWith.me ${typeLabel.toLowerCase()}.`,
    '',
    'You can now set up memorial pages for the families you work with and refer them in — they take over custody from there.',
    '',
    `Partner dashboard: ${link}`,
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          Welcome to LiveOnWith.me
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">
          <strong>${escapeHtml(args.businessName)}</strong> is approved as a LiveOnWith.me ${typeLabel.toLowerCase()}. You can now set up memorial pages for the families you work with and refer them in — they take over custody from there.
        </p>
        <p style="text-align:center;margin:32px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open the partner dashboard
          </a>
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendPartnerApplicationRejected(
  to: string,
  args: { contactName?: string; businessName: string },
) {
  const hello = firstName(args.contactName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const subject = `Your LiveOnWith.me partner application`;

  const text = [
    greeting,
    '',
    `Thanks for your interest in LiveOnWith.me. We've reviewed your application for ${args.businessName} and we're not able to bring you on as a partner at this time.`,
    '',
    'If you think we should reconsider — different partner type, more context about your business, questions about our model — just reply to this email and a person will get back to you.',
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          About your application
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">
          Thanks for your interest in LiveOnWith.me. We've reviewed your application for <strong>${escapeHtml(args.businessName)}</strong> and we're not able to bring you on as a partner at this time.
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#53635d;margin:0 0 22px;">
          If you think we should reconsider — different partner type, more context about your business, questions about our model — just reply to this email and a person will get back to you.
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

// ─── Receipts ───────────────────────────────────────────────────────────────

export async function sendWholesaleReceipt(
  to: string,
  args: {
    contactName?: string;
    amountMinor: number;
    currency: string;
    deceasedFullName: string;
    bereavedName?: string;
    referralId: string;
    sessionId: string;
  },
) {
  const hello = firstName(args.contactName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const amount = formatMoney(args.amountMinor, args.currency);
  const link = `${siteUrl()}/partner/referrals/${encodeURIComponent(args.referralId)}`;
  const subject = `Receipt for ${args.deceasedFullName}'s memorial · ${amount}`;

  const text = [
    greeting,
    '',
    `This is your receipt for the LiveOnWith.me wholesale fee for ${args.deceasedFullName}'s memorial.`,
    '',
    `Amount: ${amount}`,
    `Reference: ${args.sessionId}`,
    args.bereavedName ? `Family contact: ${args.bereavedName}` : '',
    '',
    `Open the referral to send the invite: ${link}`,
    '',
    '— LiveOnWith.me',
  ]
    .filter(Boolean)
    .join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          Receipt
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">
          This is your receipt for the LiveOnWith.me wholesale fee for <strong>${escapeHtml(args.deceasedFullName)}</strong>'s memorial.
        </p>
        <table cellpadding="0" cellspacing="0" style="font-family:Inter,system-ui,sans-serif;font-size:15px;color:#25312d;width:100%;margin:0 0 22px;">
          <tr><td style="padding:6px 12px 6px 0;color:#6d7772;width:120px;">Amount</td><td style="padding:6px 0;"><strong>${escapeHtml(amount)}</strong></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#6d7772;">Reference</td><td style="padding:6px 0;font-family:ui-monospace,monospace;font-size:13px;">${escapeHtml(args.sessionId)}</td></tr>
          ${args.bereavedName ? `<tr><td style="padding:6px 12px 6px 0;color:#6d7772;">Family contact</td><td style="padding:6px 0;">${escapeHtml(args.bereavedName)}</td></tr>` : ''}
        </table>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open the referral
          </a>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          Stripe will also send a payment receipt for the card charge itself. Keep both for your records.
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendFamilyClaimedReferral(
  to: string,
  args: {
    contactName?: string;
    deceasedFullName: string;
    bereavedName?: string;
    referralId: string;
  },
) {
  const hello = firstName(args.contactName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const bereaved = args.bereavedName?.trim() || 'The family';
  const link = `${siteUrl()}/partner/referrals/${encodeURIComponent(args.referralId)}`;
  const subject = `${bereaved} has claimed ${args.deceasedFullName}'s memorial`;

  const text = [
    greeting,
    '',
    `${bereaved} has taken over custody of ${args.deceasedFullName}'s memorial on LiveOnWith.me — you've done your part. From here, they manage the memorial themselves.`,
    '',
    `Open the referral: ${link}`,
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          The family took over
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          <strong>${escapeHtml(bereaved)}</strong> has taken over custody of <strong>${escapeHtml(args.deceasedFullName)}</strong>'s memorial on LiveOnWith.me — you've done your part. From here, they manage the memorial themselves.
        </p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open the referral
          </a>
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendMemorialPaymentReceipt(
  to: string,
  args: {
    recipientName?: string;
    amountMinor: number;
    currency: string;
    deceasedFullName: string;
    memorialSlug: string;
    sessionId: string;
  },
) {
  const hello = firstName(args.recipientName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const amount = formatMoney(args.amountMinor, args.currency);
  const publicLink = `${siteUrl()}/m/${encodeURIComponent(args.memorialSlug)}`;
  const manageLink = `${siteUrl()}/memorial/${encodeURIComponent(args.memorialSlug)}/manage`;
  const subject = `${args.deceasedFullName}'s memorial is live · ${amount}`;

  const text = [
    greeting,
    '',
    `${args.deceasedFullName}'s memorial is now live on LiveOnWith.me — thank you.`,
    '',
    `Amount: ${amount}`,
    `Reference: ${args.sessionId}`,
    '',
    `Share the memorial: ${publicLink}`,
    `Manage it: ${manageLink}`,
    '',
    'The one-time fee covers hosting for life. Stripe will also send a payment receipt for the card charge itself.',
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          ${escapeHtml(args.deceasedFullName)}'s memorial is live
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">
          Thank you for publishing — the memorial is now reachable at its link, so you can share it with family and friends.
        </p>
        <table cellpadding="0" cellspacing="0" style="font-family:Inter,system-ui,sans-serif;font-size:15px;color:#25312d;width:100%;margin:0 0 22px;">
          <tr><td style="padding:6px 12px 6px 0;color:#6d7772;width:120px;">Amount</td><td style="padding:6px 0;"><strong>${escapeHtml(amount)}</strong></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#6d7772;">Reference</td><td style="padding:6px 0;font-family:ui-monospace,monospace;font-size:13px;">${escapeHtml(args.sessionId)}</td></tr>
        </table>
        <p style="text-align:center;margin:28px 0;">
          <a href="${publicLink}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open the memorial
          </a>
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          Manage it any time at <a href="${manageLink}" style="color:#688076;">${manageLink}</a>. The one-time fee covers hosting for life. Stripe will also send a payment receipt for the card charge itself.
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

// ─── Custody acceptance follow-ups ──────────────────────────────────────────

export async function sendCoManagerAcceptedToOwner(
  to: string,
  args: {
    ownerName?: string;
    coManagerName?: string;
    coManagerEmail: string;
    memorialName: string;
    memorialId: string;
  },
) {
  const hello = firstName(args.ownerName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const who = args.coManagerName?.trim() || args.coManagerEmail;
  const link = `${siteUrl()}/memorial/${encodeURIComponent(args.memorialId)}/manage`;
  const subject = `${who} is now a co-manager on ${args.memorialName}'s memorial`;

  const text = [
    greeting,
    '',
    `${who} accepted your invitation and is now a co-manager on ${args.memorialName}'s memorial. They can approve memories, add photos, and edit the story alongside you. You stay in charge of publishing, succession and billing.`,
    '',
    `Open the memorial: ${link}`,
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          You've got a hand with ${escapeHtml(args.memorialName)}'s memorial
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          <strong>${escapeHtml(who)}</strong> accepted your invitation and is now a co-manager. They can approve memories, add photos, and edit the story alongside you. You stay in charge of publishing, succession and billing.
        </p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open the memorial
          </a>
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendCoManagerConfirmation(
  to: string,
  args: { recipientName?: string; memorialName: string; memorialId: string },
) {
  const hello = firstName(args.recipientName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const link = `${siteUrl()}/memorial/${encodeURIComponent(args.memorialId)}/manage`;
  const subject = `You're a co-manager on ${args.memorialName}'s memorial`;

  const text = [
    greeting,
    '',
    `You're now helping manage ${args.memorialName}'s memorial on LiveOnWith.me. You can approve memories, add photos, and edit the story.`,
    '',
    `Open the memorial: ${link}`,
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          You're a co-manager
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          You're now helping manage <strong>${escapeHtml(args.memorialName)}</strong>'s memorial on LiveOnWith.me. You can approve memories, add photos, and edit the story.
        </p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open the memorial
          </a>
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendSuccessionCompletedToNewOwner(
  to: string,
  args: { recipientName?: string; memorialName: string; memorialId: string },
) {
  const hello = firstName(args.recipientName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const link = `${siteUrl()}/memorial/${encodeURIComponent(args.memorialId)}/manage`;
  const subject = `You now look after ${args.memorialName}'s memorial`;

  const text = [
    greeting,
    '',
    `Custody of ${args.memorialName}'s memorial on LiveOnWith.me has moved to you. You can now manage everything — content, publishing, co-managers and succession. The memorial URL stays the same.`,
    '',
    `Open the memorial: ${link}`,
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          You now look after ${escapeHtml(args.memorialName)}'s memorial
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          Custody has moved to you. You can now manage everything — content, publishing, co-managers and succession. The memorial URL stays the same.
        </p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Open the memorial
          </a>
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

// ─── Account deletion (GDPR Article 17) ─────────────────────────────────────

export async function sendAccountDeletedConfirmation(
  to: string,
  args: {
    recipientName?: string;
    orphanedMemorials: Array<{ fullName: string; restoreDeadline: string }>;
  },
) {
  const hello = firstName(args.recipientName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const subject = `Your LiveOnWith.me account has been deleted`;

  const orphanLines = args.orphanedMemorials.length
    ? [
        '',
        `A few memorial pages you looked after had no one else assigned, so they've been taken offline. If this was a mistake, reply to this email before the date beside each one and we can restore it:`,
        '',
        ...args.orphanedMemorials.map(
          (m) => `• ${m.fullName} — restorable until ${m.restoreDeadline}`,
        ),
      ]
    : [];

  const text = [
    greeting,
    '',
    'Your LiveOnWith.me account has been deleted. Your sign-in, your profile, and the personal details on any memories you contributed on other pages have been removed.',
    ...orphanLines,
    '',
    "If you didn't ask for this to happen, reply to this email as soon as possible.",
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const orphanHtml = args.orphanedMemorials.length
    ? `
        <p style="font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#25312d;margin:22px 0 10px;">
          A few memorial pages you looked after had no one else assigned, so they've been taken offline. If this was a mistake, reply to this email before the date beside each one and we can restore it:
        </p>
        <ul style="font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.7;color:#25312d;padding-left:20px;margin:0 0 22px;">
          ${args.orphanedMemorials
            .map(
              (m) =>
                `<li><strong>${escapeHtml(m.fullName)}</strong> — restorable until ${escapeHtml(m.restoreDeadline)}</li>`,
            )
            .join('')}
        </ul>`
    : '';

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          Your account has been deleted
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">
          Your LiveOnWith.me account has been deleted. Your sign-in, your profile, and the personal details on any memories you contributed on other pages have been removed.
        </p>
        ${orphanHtml}
        <p style="font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#6d7772;margin:22px 0 0;">
          If you didn't ask for this to happen, reply to this email as soon as possible and we'll help.
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendSuccessionCompletedToPreviousOwner(
  to: string,
  args: {
    recipientName?: string;
    newOwnerName?: string;
    newOwnerEmail: string;
    memorialName: string;
    memorialId: string;
  },
) {
  const hello = firstName(args.recipientName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const who = args.newOwnerName?.trim() || args.newOwnerEmail;
  const link = `${siteUrl()}/memorial/${encodeURIComponent(args.memorialId)}/manage`;
  const subject = `${args.memorialName}'s memorial has passed to ${who}`;

  const text = [
    greeting,
    '',
    `Custody of ${args.memorialName}'s memorial has moved to ${who} on LiveOnWith.me. You're still listed as a backup custodian, so the memorial stays visible on your dashboard.`,
    '',
    `View the memorial: ${link}`,
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          Custody has passed to ${escapeHtml(who)}
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 22px;">
          <strong>${escapeHtml(who)}</strong> now looks after <strong>${escapeHtml(args.memorialName)}</strong>'s memorial. You're still listed as a backup custodian, so the memorial stays visible on your dashboard.
        </p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${link}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            View the memorial
          </a>
        </p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendContributionReportAdmin(args: {
  reportId: string;
  memorialId: string;
  memorialName: string;
  memorialSlug?: string;
  contributionId: string;
  reason: string;
  reporterEmail?: string;
  reporterUid?: string;
}) {
  const inbox = `${siteUrl()}/admin/reports`;
  const memorialLink = args.memorialSlug
    ? `${siteUrl()}/m/${args.memorialSlug}`
    : `${siteUrl()}/admin/memorials/${args.memorialId}`;

  const subject = `Reported memory on ${args.memorialName}`;
  const reporter = args.reporterEmail
    ? args.reporterEmail
    : args.reporterUid
      ? `Signed-in user (uid ${args.reporterUid.slice(0, 8)}…)`
      : 'Anonymous visitor';

  const text = [
    `A visitor reported a memory on ${args.memorialName}.`,
    '',
    `Memorial: ${memorialLink}`,
    `Contribution id: ${args.contributionId}`,
    `Reporter: ${reporter}`,
    '',
    'Reason:',
    args.reason,
    '',
    `Resolve in admin: ${inbox}`,
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          Reported memory
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:15px;color:#25312d;line-height:1.55;margin:0 0 18px;">
          A visitor flagged a memory on <strong>${escapeHtml(args.memorialName)}</strong> for review.
        </p>
        <table cellpadding="0" cellspacing="0" style="font-family:Inter,system-ui,sans-serif;font-size:14px;color:#25312d;width:100%;margin:0 0 22px;">
          <tr>
            <td style="padding:6px 12px 6px 0;color:#6d7772;vertical-align:top;width:120px;">Memorial</td>
            <td style="padding:6px 0;"><a href="${memorialLink}" style="color:#25312d;">${escapeHtml(args.memorialName)}</a></td>
          </tr>
          <tr>
            <td style="padding:6px 12px 6px 0;color:#6d7772;vertical-align:top;">Contribution id</td>
            <td style="padding:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">${escapeHtml(args.contributionId)}</td>
          </tr>
          <tr>
            <td style="padding:6px 12px 6px 0;color:#6d7772;vertical-align:top;">Reporter</td>
            <td style="padding:6px 0;">${escapeHtml(reporter)}</td>
          </tr>
        </table>
        <div style="background:#faf7f0;border:1px solid #e6dfc9;border-radius:12px;padding:14px 16px;font-family:Inter,system-ui,sans-serif;font-size:14px;color:#25312d;white-space:pre-wrap;margin:0 0 24px;">${escapeHtml(args.reason)}</div>
        <p style="text-align:center;margin:28px 0;">
          <a href="${inbox}" style="display:inline-block;background:#25312d;color:#ffffff;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:650;padding:14px 28px;border-radius:999px;">
            Review in admin
          </a>
        </p>
  `);

  await client().send({
    to: SUPER_ADMIN_EMAIL,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}

export async function sendEmailChangeNotice(
  to: string,
  args: { newEmail: string; recipientName?: string },
) {
  const hello = firstName(args.recipientName);
  const greeting = hello ? `Hi ${hello},` : 'Hello,';
  const supportLink = `mailto:${SUPER_ADMIN_EMAIL}?subject=${encodeURIComponent('Suspicious email change on my LiveOnWith.me account')}`;
  const subject = 'Your LiveOnWith.me email change request';

  const text = [
    greeting,
    '',
    `We received a request to change the email on your LiveOnWith.me account to ${args.newEmail}.`,
    '',
    `To complete the change, click the verification link we sent to ${args.newEmail}. Until that link is clicked, your email stays as ${to}.`,
    '',
    `If this wasn't you, email ${SUPER_ADMIN_EMAIL} straight away. We'll secure the account.`,
    '',
    '— LiveOnWith.me',
  ].join('\n');

  const html = wrapEmail(`
        <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;line-height:1.25;margin:0 0 18px;color:#25312d;">
          Email change requested
        </h1>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">${greeting}</p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">
          We received a request to change the email on your LiveOnWith.me account to
          <strong>${escapeHtml(args.newEmail)}</strong>.
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:16px;line-height:1.6;color:#25312d;margin:0 0 18px;">
          A verification link has been sent to that address. Until the link is clicked, your email stays as
          <strong>${escapeHtml(to)}</strong>.
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#6d7772;margin:0 0 22px;">
          If this wasn&rsquo;t you,
          <a href="${supportLink}" style="color:#25312d;">email us straight away</a>
          and we&rsquo;ll secure the account.
        </p>
        <p style="font-family:Inter,system-ui,sans-serif;font-size:13px;color:#6d7772;margin:28px 0 0;">— LiveOnWith.me</p>
  `);

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
    ...TRANSACTIONAL_SETTINGS,
  });
}
