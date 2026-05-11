const { Resend } = require('resend');

function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function scoreColor(score) {
  if (score >= 500) return '#16a34a';
  if (score >= 300) return '#ca8a04';
  return '#2563eb';
}

function buildEmailHtml(outliers, date) {
  const rows = outliers.map((v, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'};">
      <td style="padding:16px 12px; vertical-align:top; width:60px; text-align:center;">
        <span style="
          display:inline-block;
          font-size:28px;
          font-weight:900;
          color:${scoreColor(v.score)};
          line-height:1;
        ">${v.score}</span>
        <div style="font-size:10px; color:#6b7280; margin-top:2px;">score</div>
      </td>
      <td style="padding:16px 12px; vertical-align:top;">
        <a href="${v.url}" style="
          font-size:15px;
          font-weight:700;
          color:#111827;
          text-decoration:none;
          display:block;
          margin-bottom:4px;
          line-height:1.4;
        ">${v.title}</a>
        <div style="font-size:13px; color:#6b7280; margin-bottom:6px;">
          📺 ${v.channelName}
        </div>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <span style="
            font-size:13px;
            background:#dbeafe;
            color:#1e40af;
            padding:2px 8px;
            border-radius:99px;
            font-weight:600;
          ">👁 ${formatNumber(v.views)} vistas</span>
          <span style="font-size:12px; color:#9ca3af;">
            Promedio canal: ${formatNumber(v.averageViews)}
          </span>
        </div>
      </td>
      <td style="padding:16px 12px; vertical-align:middle; text-align:center; width:100px;">
        <a href="${v.url}" style="
          display:inline-block;
          background:#ef4444;
          color:#ffffff;
          font-size:12px;
          font-weight:700;
          padding:8px 14px;
          border-radius:6px;
          text-decoration:none;
          white-space:nowrap;
        ">▶ Ver video</a>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Outlier Finder Report</title>
</head>
<body style="margin:0; padding:0; background:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6; padding:32px 0;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px; width:100%;">

          <!-- Header -->
          <tr>
            <td style="
              background:linear-gradient(135deg,#1e1b4b 0%,#312e81 100%);
              padding:32px 40px;
              border-radius:12px 12px 0 0;
              text-align:center;
            ">
              <div style="font-size:36px; margin-bottom:8px;">🚀</div>
              <h1 style="margin:0; font-size:26px; font-weight:900; color:#ffffff; letter-spacing:-0.5px;">
                Outlier Finder
              </h1>
              <p style="margin:8px 0 0; font-size:14px; color:#c7d2fe;">
                Reporte diario · ${date}
              </p>
            </td>
          </tr>

          <!-- Summary bar -->
          <tr>
            <td style="background:#4f46e5; padding:16px 40px;">
              <p style="margin:0; font-size:14px; color:#e0e7ff; text-align:center;">
                ✅ Se encontraron <strong style="color:#ffffff; font-size:16px;">${outliers.length} videos outlier</strong>
                con score ≥ 200 (el doble del promedio del canal o más)
              </p>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="background:#ffffff; border-radius:0 0 12px 12px; overflow:hidden;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <thead>
                  <tr style="background:#f9fafb; border-bottom:2px solid #e5e7eb;">
                    <th style="padding:12px; text-align:center; font-size:12px; color:#6b7280; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; width:60px;">Score</th>
                    <th style="padding:12px; text-align:left; font-size:12px; color:#6b7280; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">Video</th>
                    <th style="padding:12px; width:100px;"></th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px; text-align:center;">
              <p style="margin:0; font-size:12px; color:#9ca3af;">
                Generado automáticamente por Outlier Finder · Score = (vistas / promedio canal) × 100
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendOutlierEmail(resendApiKey, emailTo, emailFrom, outliers) {
  const resend = new Resend(resendApiKey);
  const date = new Date().toLocaleDateString('es-ES', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const html = buildEmailHtml(outliers, date);

  const { data, error } = await resend.emails.send({
    from: emailFrom,
    to: emailTo,
    subject: `🚀 Outlier Finder: ${outliers.length} videos virales detectados · ${new Date().toLocaleDateString('es-ES')}`,
    html,
  });

  if (error) throw new Error(`Error al enviar email: ${JSON.stringify(error)}`);
  return data;
}

module.exports = { sendOutlierEmail };
