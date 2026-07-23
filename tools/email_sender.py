import smtplib
from email.message import EmailMessage
from dotenv import load_dotenv
import os
from langchain.tools import tool

load_dotenv()
SMTP_SERVER = os.getenv("SMTP_SERVER")
SMTP_PORT = os.getenv("SMTP_PORT")
APP_PASS = os.getenv("APP_PASSWORD")
USER_ADD = os.getenv("USER_ADD")


@tool
def send_email(recepient: str, dearClient: str, subject: str, message: str):
    """Send and Email to a recepient
        Use this when the user wants to send an email to a user. The message must be only be in plain text format.
    Args:
        recepient: the email address of the receiver
        dearClient : the greeting of the email example: Dear John, Dear Mr. Smith
        subject : the subject line of the email
        message: the message body of the email. Should be in plain text format and no signatures.
    """
    message_template = f"""
    <!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Claude's Demo</title>
</head>

<body style="margin:0; padding:0; background-color:#f4f4f4; font-family:Arial, sans-serif;">

    <table width="100%" cellpadding="0" cellspacing="0" style="padding:30px 0;">
        <tr>
            <td align="center">

                <table width="600px" cellpadding="0" cellspacing="0" 
                       style="background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.1);">

                    <!-- Header -->
                    <tr>
                        <td style="background:#2563eb; padding:25px; text-align:center; color:white;">
                            <h1 style="margin:0; font-size:28px;">Claude's Demo</h1>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding:35px; color:#333;">
                            <h2 style="margin-top:0; color:#2563eb;">
                                 {dearClient}
                            </h2>

                            <p style="font-size:16px;">
                            {message}
                            </p>

                            <a href="https://lackey43.github.io/portfolio/" 
                               style="display:inline-block; 
                                      background:#2563eb; 
                                      color:#ffffff; 
                                      padding:12px 25px; 
                                      text-decoration:none; 
                                      border-radius:6px; 
                                      margin-top:15px;">
                                Contact Us
                            </a>

                            <p style="margin-top:30px; font-size:16px;">
                                Have a great day!
                            </p>

                            <p style="font-size:16px;">
                                Best regards,<br>
                                <strong>Claude's Demo</strong>
                            </p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background:#f8fafc; padding:20px; text-align:center; font-size:13px; color:#666;">
                            © 2026 Claude's Demo. All rights reserved.
                        </td>
                    </tr>

                </table>

            </td>
        </tr>
    </table>

</body>
</html>
    """
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = USER_ADD
    msg["To"] = recepient

    msg.add_alternative(message_template, subtype="html")

    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(user=USER_ADD, password=APP_PASS)
            server.send_message(msg)
        print("message sent")
        return f"Message is sent to: {recepient}\n\n with message:\n{message}"
    except Exception as e:
        print(f"Failed to submit email: {e}")
        return f"Failed to submit the email because {e}"


# if __name__ == "__main__":
#     message = "This is a test message by Claude Daigan"
#     sender = "miketacovic@gmail.com"
#     recepient = "fayecamillebarja@gmail.com"
#     recepientName = "Camille"
#     subject = "Claude's Demo"
#     send_email(sender, recepient, recepientName, subject, message)
