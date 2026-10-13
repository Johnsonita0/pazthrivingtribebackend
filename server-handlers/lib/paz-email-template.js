export function buildPazEmailTemplate({
  title,
  eyebrow = 'PAZ Thriving Tribe',
  intro = 'Hello,',
  bodyHtml = '',
  ctaLabel = 'Apply for a session',
  ctaUrl = `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/teens_reg`,
  showSecondaryCta = true,
  secondaryCtaLabel = 'Book for a session',
  secondaryCtaUrl = `${process.env.VITE_APP_URL || 'https://pazthrivingtribe.org'}/book-session`,
  accentText = '',
  footerNote = 'We are here to help your growth journey.',
  productDownloadUrl = '',
  productName = 'your product'
}) {
  const websiteUrl = process.env.VITE_APP_URL || 'https://pazthrivingtribe.org';
  const logoUrl = `${websiteUrl}/logo/logo2.jpeg`;
  const contactPhone = '+234 803 738 3820';
  const whatsappUrl = 'https://wa.me/2348037383820';

  const safeTitle = String(title || 'PAZ Thriving Tribe');
  const safeEyebrow = String(eyebrow || 'PAZ Thriving Tribe');
  const safeIntro = String(intro || 'Hello,');
  const safeAccentText = accentText ? String(accentText) : '';
  const safeProductName = String(productName || 'your product');
  const safeProductDownloadUrl = String(productDownloadUrl || '').trim();

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeTitle}</title>
      </head>
      <body style="margin:0;padding:0;background:#edf4ef;font-family:Arial,Helvetica,sans-serif;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#edf4ef;padding:24px 12px;border-collapse:collapse;">
          <tr>
            <td align="center" style="text-align:center;">
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:640px;margin:0 auto;background:#ffffff;border-collapse:separate;border-spacing:0;border-radius:18px;overflow:hidden;">
                <tr>
                  <td align="center" style="padding:24px 20px;background:linear-gradient(135deg,#0b2f2a 0%,#123d35 52%,#1c5c4a 100%);text-align:center;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;border-collapse:separate;border-spacing:0;">
                      <tr>
                        <td style="padding-right:12px;">
                          <img src="${logoUrl}" alt="PAZ logo" width="54" height="54" style="display:block;border:0;outline:none;border-radius:14px;background:#ffffff;padding:6px;" />
                        </td>
                        <td style="color:#f7e7b4;font-family:Arial,Helvetica,sans-serif;line-height:1.1;">
                          <div style="font-size:24px;font-weight:900;letter-spacing:0.08em;">PAZ</div>
                          <div style="font-size:10px;font-weight:800;letter-spacing:0.18em;opacity:0.92;">THRIVING TRIBE</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:26px 28px 10px;background:#ffffff;">
                    <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#1c6d5d;font-weight:800;">${safeEyebrow}</div>
                    <h1 style="margin:14px 0 10px;font-size:30px;line-height:1.2;color:#0d2f2a;font-weight:900;">${safeTitle}</h1>
                    <p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#1d3d39;">${safeIntro}</p>
                    ${safeAccentText ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#0b352d;font-weight:800;">${safeAccentText}</p>` : ''}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 28px 8px;background:#ffffff;">
                    <div style="background:#f6f9f6;border:1px solid #dfeee4;border-radius:14px;padding:18px 18px 10px;color:#1d3d39;font-size:15px;line-height:1.7;">
                      ${bodyHtml}
                    </div>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding:20px 20px 8px;background:#ffffff;text-align:center;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;border-collapse:separate;border-spacing:0;">
                      <tr>
                        <td style="padding-right:6px;">
                          <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#e3bf6a,#d4a848);color:#152b24;padding:14px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:900;">${ctaLabel}</a>
                        </td>
                        ${showSecondaryCta ? `<td style="padding-left:6px;"><a href="${secondaryCtaUrl}" style="display:inline-block;background:#edf7f0;color:#14392f;padding:14px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:800;border:1px solid #d1e6d7;">${secondaryCtaLabel}</a></td>` : ''}
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:22px 20px 26px;background:#0b2a23;color:#edf4f1;text-align:center;">
                    <div style="margin-bottom:12px;">
                      <a href="https://www.instagram.com/pazthrivingtribe" target="_blank" rel="noopener noreferrer" aria-label="Instagram" style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;background:#344f47;border:1px solid #55746a;border-radius:50%;margin:0 6px;vertical-align:middle;text-decoration:none;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:900;">◎</a>
                      <a href="https://facebook.com/pazthrivingtribe" target="_blank" rel="noopener noreferrer" aria-label="Facebook" style="display:inline-block;width:34px;height:34px;line-height:36px;text-align:center;background:#344f47;border:1px solid #55746a;border-radius:50%;margin:0 6px;vertical-align:middle;text-decoration:none;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:21px;font-weight:900;">f</a>
                      <a href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;background:#344f47;border:1px solid #55746a;border-radius:50%;margin:0 6px;vertical-align:middle;text-decoration:none;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:900;">WA</a>
                      <a href="https://www.linkedin.com/company/pazthrivingtribe" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;background:#344f47;border:1px solid #55746a;border-radius:50%;margin:0 6px;vertical-align:middle;text-decoration:none;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:900;">in</a>
                    </div>
                    <div style="font-size:12px;line-height:1.8;color:#dfeeea;">
                      <div style="font-size:14px;font-weight:800;color:#f7d980;margin-bottom:4px;">PAZ Thriving Tribe</div>
                      <div>${footerNote}</div>
                      <div>Email: <a href="mailto:pazthrivingtribe@gmail.com" style="color:#f7d980;text-decoration:none;">pazthrivingtribe@gmail.com</a> | WhatsApp: <a href="${whatsappUrl}" style="color:#f7d980;text-decoration:none;">${contactPhone}</a></div>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 0;border-collapse:separate;border-spacing:0;">
                        <tr>
                          <td style="background:#f7d980;border-radius:7px;text-align:center;">
                            <a href="${websiteUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:11px 20px;color:#0b2a23;text-decoration:none;font-size:13px;font-weight:900;">Visit the PAZ website</a>
                          </td>
                        </tr>
                      </table>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

