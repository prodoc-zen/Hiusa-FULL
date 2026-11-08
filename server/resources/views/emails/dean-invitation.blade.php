<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your HIUSA invitation</title>
</head>
<body style="margin:0;padding:0;background-color:#EEF6FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#EEF6FB;padding:40px 16px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#FFFFFF;border:1px solid #DDE7EF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(11,24,49,0.06);">
                    <!-- Brand Header -->
                    <tr>
                        <td style="background-color:#0B1831;padding:28px 32px;border-bottom:3px solid #0878B7;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td>
                                        <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#16C7F3;letter-spacing:0.12em;text-transform:uppercase;">University of Cebu · Student Affairs Office</p>
                                        <h1 style="margin:0;font-size:22px;font-weight:800;color:#FFFFFF;line-height:1.3;">HIUSA Academic Governance</h1>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td style="padding:32px 32px 24px;">
                            <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#0F172A;">Hello,</p>
                            <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#334155;">
                                You are invited to join <strong>{{ $collegeName }}</strong> on HIUSA as <strong>{{ $roleLabel }}</strong>.
                            </p>
                            
                            <!-- Call to Action Box -->
                            <div style="background-color:#F8FBFD;border:1px solid #DDE7EF;border-radius:8px;padding:24px;text-align:center;margin:0 0 24px;">
                                <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#0F2F62;">Create your account:</p>
                                <a href="{{ $magicLink }}" style="display:inline-block;background-color:#0878B7;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:6px;box-shadow:0 2px 6px rgba(8,120,183,0.35);">Create my account</a>
                            </div>

                            <p style="margin:0 0 8px;font-size:12px;color:#64748B;line-height:1.6;">
                                Or paste this link into your browser:
                            </p>
                            <p style="margin:0 0 20px;font-size:12px;line-height:1.5;word-break:break-all;color:#0878B7;">
                                <a href="{{ $magicLink }}" style="color:#0878B7;text-decoration:underline;">{{ $magicLink }}</a>
                            </p>

                            <div style="border-top:1px solid #E2E8F0;padding-top:16px;">
                                <p style="margin:0 0 6px;font-size:12px;color:#64748B;">
                                    The link works once and expires in {{ $expiresInHours }} hours.
                                </p>
                                <p style="margin:0;font-size:12px;color:#94A3B8;">
                                    If you were not expecting this, you can ignore this message.
                                </p>
                            </div>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background-color:#F8FBFD;border-top:1px solid #DDE7EF;padding:16px 32px;text-align:center;">
                            <p style="margin:0;font-size:11px;color:#94A3B8;">HIUSA System · University Student Organization Portal</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>

