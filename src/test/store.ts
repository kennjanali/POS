/**
 * Store helpers for tests. Node has no `window`, so nothing here is ever
 * written to storage.
 */

import { uuidv7 } from '@/lib/id';
import type { Role, User } from '@/lib/types';
import { useAuth } from '@/store/useAuth';
import { usePos, type SetupInput } from '@/store/usePos';

const SETUP: SetupInput = {
  shopType: 'restaurant',
  businessName: 'Test Shop',
  ownerName: 'Owner',
  pin: '481902',
  recoveryCode: 'ABCD-EFGH-JKLM',
  catalog: 'sample',
};

/** Back to a fresh install, signed out. */
export function resetStore(): void {
  usePos.setState(usePos.getInitialState(), true);
  useAuth.setState(useAuth.getInitialState(), true);
}

function signIn(user: User): void {
  useAuth.setState({
    session: { userId: user.id, name: user.name, role: user.role, signedInAt: Date.now() },
  });
}

/** Add a user with this role and sign them in. Their PIN never verifies. */
export function signInAs(role: Role): string {
  const user: User = {
    id: uuidv7(),
    name: `Test ${role}`,
    role,
    active: true,
    pin: { salt: '', hash: '', iterations: 1 },
    createdAt: Date.now(),
    lastLoginAt: null,
  };
  usePos.setState((s) => ({ users: [...s.users, user] }));
  signIn(user);
  return user.id;
}

/** Run the first-run wizard with a fixed input and sign the owner in. */
export async function ownerShop(): Promise<void> {
  const result = await usePos.getState().setupInstall(SETUP);
  if (!result.ok) throw new Error(result.error);
  signIn(usePos.getState().users[0]!);
}
