// Resend 邮件发送封装
// 环境变量：
//   RESEND_API_KEY - 在 https://resend.com 注册后获取
//   EMAIL_FROM     - 发件人地址，如：工大圈子 <noreply@agent666.xyz>

const RESEND_API_URL = 'https://api.resend.com/emails';
const BRAND_NAME = '工大圈子';
const BRAND_COLOR = '#4A90D9';

function getConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || `${BRAND_NAME} <onboarding@resend.dev>`;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY 未配置，请在 server/.env 中设置');
  }
  // 从 EMAIL_FROM 里提取域名，用于构造 List-Unsubscribe / reply-to
  const match = from.match(/<([^@]+)@([^>]+)>/);
  const domain = match ? match[2] : 'resend.dev';
  const senderAddress = match ? `${match[1]}@${match[2]}` : from;
  return { apiKey, from, domain, senderAddress };
}

function buildSubject(purpose) {
  return purpose === 'register'
    ? `${BRAND_NAME} 注册验证码`
    : `${BRAND_NAME} 重置密码验证码`;
}

function buildTextBody(code, purpose) {
  const action = purpose === 'register' ? '注册' : '重置密码';
  return (
    `你好，\n\n` +
    `你正在进行${action}操作，验证码：\n\n` +
    `    ${code}\n\n` +
    `验证码 10 分钟内有效，请勿泄露给他人。\n\n` +
    `如非本人操作，请忽略此邮件，账号安全不受影响。\n\n` +
    `—— ${BRAND_NAME}\n` +
    `此邮件由系统自动发送，请勿回复。`
  );
}

function buildHtmlBody(code, purpose) {
  const action = purpose === 'register' ? '注册' : '重置密码';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${BRAND_NAME} ${action}验证码</title>
</head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f6fa;padding:40px 20px;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
        <tr>
          <td style="background:${BRAND_COLOR};padding:24px 32px;color:#ffffff;">
            <div style="font-size:20px;font-weight:600;letter-spacing:2px;">${BRAND_NAME}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;color:#333333;font-size:15px;line-height:1.7;">
            <p style="margin:0 0 16px;">你好，</p>
            <p style="margin:0 0 24px;">你正在进行 <strong>${action}</strong> 操作，请在页面中输入以下验证码完成验证：</p>
            <div style="background:#f0f6ff;border-left:4px solid ${BRAND_COLOR};padding:20px 24px;margin:0 0 24px;text-align:center;border-radius:4px;">
              <div style="font-size:32px;font-weight:700;letter-spacing:10px;color:${BRAND_COLOR};font-family:'Courier New',Consolas,monospace;">${code}</div>
            </div>
            <p style="margin:0 0 10px;color:#666666;font-size:13px;">验证码 10 分钟内有效，请勿泄露给他人。</p>
            <p style="margin:0;color:#666666;font-size:13px;">如非本人操作，请忽略此邮件，账号安全不受影响。</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;background:#fafafa;color:#999999;font-size:12px;line-height:1.6;text-align:center;border-top:1px solid #eeeeee;">
            <div style="margin:0 0 4px;">此邮件由系统自动发送，请勿回复。</div>
            <div>&copy; ${BRAND_NAME}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

async function sendVerificationEmail(email, code, purpose) {
  const { apiKey, from, domain, senderAddress } = getConfig();
  const subject = buildSubject(purpose);
  const text = buildTextBody(code, purpose);
  const html = buildHtmlBody(code, purpose);

  const body = {
    from,
    to: email,
    subject,
    text,
    html,
    reply_to: senderAddress,
    headers: {
      // Gmail 把 List-Unsubscribe 作为合法发件方的信号（即使是事务邮件）
      'List-Unsubscribe': `<mailto:unsubscribe@${domain}>`,
    },
  };

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Resend API 失败 ${res.status}: ${errText}`);
  }
}

module.exports = { sendVerificationEmail };
