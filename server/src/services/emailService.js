// Resend 邮件发送封装
// 环境变量：
//   RESEND_API_KEY - 在 https://resend.com 注册后获取
//   EMAIL_FROM     - 发件人地址（测试期用 onboarding@resend.dev，上线换自定义域名）

const RESEND_API_URL = 'https://api.resend.com/emails';

function getConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || '工大圈子 <onboarding@resend.dev>';
  if (!apiKey) {
    throw new Error('RESEND_API_KEY 未配置，请在 server/.env 中设置');
  }
  return { apiKey, from };
}

function buildEmail(code, purpose) {
  const isRegister = purpose === 'register';
  const subject = isRegister
    ? '【工大圈子】您的注册验证码'
    : '【工大圈子】您的重置密码验证码';

  const action = isRegister ? '注册' : '重置密码';
  const text =
    `你好，\n\n` +
    `你的${action}验证码是：${code}\n\n` +
    `请在 10 分钟内使用，过期请重新获取。\n` +
    `如非本人操作，请忽略此邮件。\n\n` +
    `——工大圈子`;

  return { subject, text };
}

async function sendVerificationEmail(email, code, purpose) {
  const { apiKey, from } = getConfig();
  const { subject, text } = buildEmail(code, purpose);

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: email, subject, text }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Resend API 失败 ${res.status}: ${errText}`);
  }
}

module.exports = { sendVerificationEmail };
