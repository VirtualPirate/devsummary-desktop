import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Section,
  Text,
} from '@react-email/components';

export interface OtpEmailProps {
  otp: string;
  heading: string;
  description: string;
}

export function OtpEmail({ otp, heading, description }: OtpEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Text style={brand}>🚀 LaunchStack</Text>
          <Heading style={h1}>{heading}</Heading>
          <Text style={text}>{description}</Text>
          <Section style={codeSection}>
            <Text style={code}>{otp}</Text>
          </Section>
          <Text style={text}>This code expires in 5 minutes.</Text>
          <Hr style={hr} />
          <Text style={footer}>
            If you didn't request this, you can safely ignore this email.
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
  margin: '0 0 8px 0',
  lineHeight: '1.3',
};

const text: React.CSSProperties = {
  fontSize: '15px',
  color: '#1a1a1a',
  lineHeight: '1.6',
  margin: '0 0 16px 0',
};

const codeSection: React.CSSProperties = {
  backgroundColor: '#f5f5f5',
  borderRadius: '8px',
  border: '1px solid #e5e5e5',
  padding: '20px',
  textAlign: 'center' as const,
  margin: '24px 0',
};

const code: React.CSSProperties = {
  fontSize: '32px',
  fontWeight: 700,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  letterSpacing: '6px',
  color: '#1a1a1a',
  margin: '0',
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
