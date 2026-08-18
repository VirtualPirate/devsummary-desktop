import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Section,
  Text,
} from '@react-email/components';

export interface InviteEmailProps {
  organizationName: string;
  inviterName: string;
  role: 'admin' | 'viewer';
  acceptUrl: string;
  expiresInDays: number;
}

export function InviteEmail({
  organizationName,
  inviterName,
  role,
  acceptUrl,
  expiresInDays,
}: InviteEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Text style={brand}>🚀 LaunchStack</Text>
          <Heading style={h1}>
            You&apos;re invited to {organizationName}
          </Heading>
          <Text style={text}>
            {inviterName} invited you to join{' '}
            <strong>{organizationName}</strong> as <strong>{role}</strong>.
          </Text>
          <Section style={cta}>
            <Button href={acceptUrl} style={button}>
              Accept invite
            </Button>
          </Section>
          <Text style={text}>
            This invite expires in {expiresInDays} days. If the button above
            doesn&apos;t work, copy and paste this link:
          </Text>
          <Text style={link}>{acceptUrl}</Text>
          <Hr style={hr} />
          <Text style={footer}>
            If you weren&apos;t expecting this invite, you can safely ignore
            this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily:
    "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};
const container: React.CSSProperties = {
  maxWidth: '480px',
  margin: '0 auto',
  padding: '40px 20px',
};
const brand: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#1a1a1a',
  margin: '0 0 24px 0',
};
const h1: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 700,
  color: '#1a1a1a',
  margin: '0 0 12px 0',
  lineHeight: '1.3',
};
const text: React.CSSProperties = {
  fontSize: '15px',
  color: '#1a1a1a',
  lineHeight: '1.6',
  margin: '0 0 16px 0',
};
const cta: React.CSSProperties = { margin: '24px 0' };
const button: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#1a1a1a',
  color: '#ffffff',
  padding: '12px 20px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
};
const link: React.CSSProperties = {
  fontSize: '13px',
  color: '#2563eb',
  wordBreak: 'break-all',
};
const hr: React.CSSProperties = {
  borderTop: '1px solid #e5e5e5',
  margin: '24px 0',
};
const footer: React.CSSProperties = {
  fontSize: '13px',
  color: '#737373',
  lineHeight: '1.5',
  margin: '0',
};
