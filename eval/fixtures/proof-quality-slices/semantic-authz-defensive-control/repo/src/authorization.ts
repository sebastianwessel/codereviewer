import { SessionStore } from './session-store'

export const canViewAccount = (
  sessionStore: SessionStore,
  userId: string,
  accountId: string
): boolean => {
  const session = sessionStore.get(userId)
  if (session === undefined) {
    return false
  }

  return session.accountIds.includes(accountId)
}
