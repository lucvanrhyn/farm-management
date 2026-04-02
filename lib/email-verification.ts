import { randomUUID } from 'crypto';
import { Resend } from 'resend';

function getResend(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY must be set in environment variables.');
  return new Resend(apiKey);
}

function getEmailFrom(): string {
  return process.env.EMAIL_FROM ?? 'FarmTrack <noreply@farmtrack.app>';
}

function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL ?? 'https://farm-management-lilac.vercel.app';
}

export function generateVerificationToken(): { token: string; expiresAt: string } {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  return { token, expiresAt };
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const resend = getResend();
  const baseUrl = getBaseUrl();
  const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

  await resend.emails.send({
    from: getEmailFrom(),
    to: email,
    subject: 'Verify your FarmTrack account',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h1 style="color: #1A1510; font-size: 24px;">Welcome to FarmTrack</h1>
        <p style="color: #4A3A2A; font-size: 16px; line-height: 1.5;">
          Click the button below to verify your email address and activate your account.
        </p>
        <a href="${verifyUrl}" style="
          display: inline-block;
          background: #8B6914;
          color: #F0DEB8;
          padding: 12px 24px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 500;
          margin: 16px 0;
        ">Verify Email</a>
        <p style="color: #8A8A8A; font-size: 13px; margin-top: 24px;">
          This link expires in 24 hours. If you didn't create a FarmTrack account, ignore this email.
        </p>
      </div>
    `,
  });
}
