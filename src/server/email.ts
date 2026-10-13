import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

export async function sendAuthEmail(to: string, subject: string, url: string) {
  if (!process.env.SES_FROM_EMAIL) throw new Error('Email delivery is not configured.')
  const client = new SESClient({ region: process.env.AWS_REGION ?? 'eu-central-1' })
  await client.send(new SendEmailCommand({
    Source: process.env.SES_FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: `Forgettime · ${subject}`, Charset: 'UTF-8' },
      Body: { Text: { Data: `${subject}\n\n${url}\n\nIf you did not request this, you can ignore this email.`, Charset: 'UTF-8' } },
    },
  }))
}
