import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  CognitoIdentityProviderClient, AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand, ListUsersCommand, AdminDisableUserCommand,
  AdminEnableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { env } from '../config/env';

// Verifies signature, expiry, issuer and audience against the pool JWKS.
export const jwtVerifier = CognitoJwtVerifier.create({
  userPoolId: env.cognitoUserPoolId,
  tokenUse: 'id',
  clientId: env.cognitoClientId,
});

export const cognito = new CognitoIdentityProviderClient({ region: env.awsRegion });

export async function setUserGroup(username: string, group: string) {
  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: env.cognitoUserPoolId, Username: username, GroupName: group,
  }));
}
export async function removeUserGroup(username: string, group: string) {
  await cognito.send(new AdminRemoveUserFromGroupCommand({
    UserPoolId: env.cognitoUserPoolId, Username: username, GroupName: group,
  }));
}
export async function setUserEnabled(username: string, enabled: boolean) {
  await cognito.send(enabled
    ? new AdminEnableUserCommand({ UserPoolId: env.cognitoUserPoolId, Username: username })
    : new AdminDisableUserCommand({ UserPoolId: env.cognitoUserPoolId, Username: username }));
}
export async function listCognitoUsers(limit = 60) {
  const r = await cognito.send(new ListUsersCommand({
    UserPoolId: env.cognitoUserPoolId, Limit: limit,
  }));
  return r.Users ?? [];
}
