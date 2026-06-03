import dotenv from 'dotenv';
dotenv.config();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const env = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',

  databaseUrl: req('DATABASE_URL'),
  dbSsl: (process.env.DB_SSL ?? 'false') === 'true',

  awsRegion: req('AWS_REGION', 'eu-central-1'),
  s3Bucket: req('S3_BUCKET'),
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL ?? '',

  cognitoUserPoolId: req('COGNITO_USER_POOL_ID'),
  cognitoClientId: req('COGNITO_CLIENT_ID'),
};
