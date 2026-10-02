import sgMail from '@sendgrid/mail';

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
