export type Session = {
  readonly userId: string
  readonly accountIds: readonly string[]
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>()

  set(session: Session): void {
    this.sessions.set(session.userId, session)
  }

  get(userId: string): Session | undefined {
    return this.sessions.get(userId)
  }
}
