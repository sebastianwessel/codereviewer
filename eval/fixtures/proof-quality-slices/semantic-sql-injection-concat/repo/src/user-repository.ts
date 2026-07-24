import type { Pool } from 'pg'

export type UserRow = {
  readonly id: string
  readonly email: string
}

export class UserRepository {
  constructor(private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const result = await this.pool.query(
      `SELECT id, email FROM users WHERE email = '${email}'`
    )

    return result.rows[0] as UserRow | undefined
  }
}
