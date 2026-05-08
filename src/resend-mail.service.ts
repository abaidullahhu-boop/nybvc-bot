import { Resend } from 'resend';

export class ResendMailService {
  private readonly resend = new Resend(process.env.RESEND_API_KEY);
  private readonly fromEmail = process.env.FROM_EMAIL;

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    plainText: string,
  ) {
    try {
      const response = await this.resend.emails.send({
        from: this.fromEmail,
        to: [to],
        subject,
        html,
        text: plainText,
      });
      console.log(
        `Email sent to ${to}; Resend message ID: ${response.data.id}`,
      );
    } catch (error) {
      console.error(`Failed to send email to ${to}: ${error.message}`);
      throw error;
    }
  }
}
