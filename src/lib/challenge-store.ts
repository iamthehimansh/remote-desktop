// In-memory challenge store for WebAuthn registration/authentication
// In a multi-process setup, use Redis or a database instead.

const registrationChallenges = new Map<string, string>();
const authenticationChallenges = new Map<string, string>();

export function setRegistrationChallenge(userId: string, challenge: string) {
  registrationChallenges.set(userId, challenge);
  // Auto-expire after 5 minutes
  setTimeout(() => registrationChallenges.delete(userId), 5 * 60 * 1000);
}

export function getRegistrationChallenge(userId: string): string | undefined {
  return registrationChallenges.get(userId);
}

export function deleteRegistrationChallenge(userId: string) {
  registrationChallenges.delete(userId);
}

export function setAuthenticationChallenge(userId: string, challenge: string) {
  authenticationChallenges.set(userId, challenge);
  setTimeout(() => authenticationChallenges.delete(userId), 5 * 60 * 1000);
}

export function getAuthenticationChallenge(userId: string): string | undefined {
  return authenticationChallenges.get(userId);
}

export function deleteAuthenticationChallenge(userId: string) {
  authenticationChallenges.delete(userId);
}
