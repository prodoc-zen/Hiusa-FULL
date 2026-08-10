<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Reset your HIUSA password</title>
</head>
<body style="margin:0;background:#eef6fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef6fb;padding:32px 16px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dde7ef;border-radius:8px;overflow:hidden;">
                    <tr>
                        <td style="padding:28px 28px 12px;">
                            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0b8ed0;letter-spacing:.08em;text-transform:uppercase;">HIUSA account recovery</p>
                            <h1 style="margin:0;font-size:24px;line-height:1.25;color:#0b1831;">Reset your password</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 28px 28px;">
                            <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi {{ $user->first_name }},</p>
                            <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">We received a request to reset the password for your HIUSA account. Use the button below to choose a new password.</p>
                            <p style="margin:0 0 24px;">
                                <a href="{{ $resetUrl }}" style="display:inline-block;background:#0b8ed0;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 18px;border-radius:6px;">Reset password</a>
                            </p>
                            <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#475569;">This link expires in {{ $expiresInMinutes }} minutes.</p>
                            <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">If you did not request this, you can ignore this email.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
