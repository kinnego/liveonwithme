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

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f4ee;font-family:Georgia,'Times New Roman',serif;color:#25312d;">
    <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
      <div style="text-align:center;font-family:Georgia,serif;font-size:22px;letter-spacing:0.02em;margin-bottom:32px;color:#25312d;">
        LiveOnWith.me
      </div>
      <div style="background:#fffdf9;border:1px solid #e8e1d7;border-radius:22px;padding:36px 32px;">
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
      </div>
      <div style="text-align:center;font-family:Inter,system-ui,sans-serif;font-size:12px;color:#6d7772;margin-top:24px;">
        LiveOnWith.me — a quiet place to remember and be remembered.
      </div>
    </div>
  </body>
</html>`;

  await client().send({
    to,
    from: fromAddress(),
    subject,
    text,
    html,
  });
}
