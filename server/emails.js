/**
 * Email templates.
 *
 * Separate from index.js so they can be rendered and eyeballed without booting
 * a server, and so the routing file is not carrying markup.
 */
export const VERIFY_TTL_HOURS = 24;

/** A name goes straight into the markup below, so it has to be inert first. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The confirmation email.
 *
 * Written the way email has to be written rather than the way a page would be:
 * tables for layout, inline styles only, no flexbox, no external stylesheet,
 * no web font. Gmail strips <style> blocks in some clients and Outlook renders
 * through Word, so anything cleverer than this degrades unpredictably.
 *
 * The button is a padded table cell rather than a styled <a> for the same
 * reason, and the raw URL is repeated underneath because some clients refuse
 * to linkify or will not follow a button at all.
 */
export function verificationHtml(name, link) {
  const brand = '#1CC29F';
  const ink = '#15171A';
  const muted = '#5F6570';
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F6F7F9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:14px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td style="padding-bottom:8px;">
                <span style="display:inline-block;background:${brand};color:#FFFFFF;font-size:13px;font-weight:700;padding:6px 12px;border-radius:999px;">Split &amp; Track</span>
              </td>
            </tr>
            <tr>
              <td style="font-size:22px;font-weight:700;color:${ink};padding:12px 0 4px;">
                Confirm your email
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:22px;color:${muted};padding-bottom:24px;">
                Hi ${escapeHtml(name)}, tap the button to finish setting up your account.
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background:${brand};border-radius:10px;">
                      <a href="${link}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">Confirm email</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;line-height:20px;color:${muted};padding-top:26px;">
                Or paste this into your browser:
                <br />
                <a href="${link}" style="color:${brand};word-break:break-all;">${link}</a>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #E4E7EB;margin-top:24px;padding-top:18px;font-size:12px;line-height:18px;color:#9AA1AC;">
                The link stops working in ${VERIFY_TTL_HOURS} hours. If you did not sign up,
                ignore this — the account cannot be used until it is confirmed.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
