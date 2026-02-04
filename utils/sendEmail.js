// utils/sendEmail.js
const nodemailer = require("nodemailer");

const hasSmtp =
  Boolean(process.env.SMTP_HOST) &&
  Boolean(process.env.SMTP_PORT) &&
  Boolean(process.env.SMTP_USER) &&
  Boolean(process.env.SMTP_PASS);

let transporter = null;

if (hasSmtp) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465, 
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendEmail({ to, subject, text, html }) {
  if (!transporter) {
    console.log("📩 [DEV EMAIL FALLBACK]");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log("Text:", text);
    return { ok: true, dev: true };
  }

  const fromName = process.env.EMAIL_FROM_NAME || "LearnLoop";
  const fromEmail = process.env.EMAIL_FROM_EMAIL || process.env.SMTP_USER;

  const info = await transporter.sendMail({
    from: `${fromName} <${fromEmail}>`,
    to,
    subject,
    text,
    html,
  });

  return info;
}

module.exports = { sendEmail };
